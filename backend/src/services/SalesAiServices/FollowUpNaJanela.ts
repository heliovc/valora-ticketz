import { Op } from "sequelize";
import { CronJob } from "cron";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { cacheLayer } from "../../libs/cache";
import { generateBotReply } from "../../helpers/aiBot";
import { separarTurnoAtual } from "../../helpers/aiBotTurn";
import { deveMandarFollowUp, FIM_DA_JANELA_MS, SILENCIO_MINIMO_MS } from "../../helpers/followUpNaJanela";
import { logger } from "../../utils/logger";
import { provedoresDaEmpresa } from "../AiBotServices/AiBotProvidersService";
import { CHANNEL } from "../CloudApiServices/CloudApiChannel";
import { dentroDaJanela, sendText } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { decidir, escopoDeVendas, promptDeVendas } from "./SalesAiService";
import { extrairMarcadoresDeVendas } from "./salesAiRules";

/**
 * Follow-up da Val no WhatsApp Oficial, dentro da janela de 24h (pedido do
 * Hélio em 10/11/2026: "precisam ser enviados antes da janela de 24 horas para
 * não pagarmos").
 *
 * Vale para quem RESPONDEU e depois ficou em silêncio, com a nossa mensagem por
 * último. Quem nunca respondeu não tem janela aberta: só sairia modelo pago, e
 * a abertura já foi. Uma vez por silêncio do lead; a própria Val escreve,
 * retomando o ponto em que a conversa parou.
 */
const ETAPAS_SEM_FOLLOW_UP = new Set(["sem_interesse", "transferido"]);
const TRES_DIAS_S = 3 * 24 * 60 * 60;

export function instrucaoDoFollowUp(horas: number): string {
  return [
    `[SISTEMA] O lead não responde há cerca de ${horas} horas e a janela gratuita do WhatsApp fecha em breve.`,
    "Escreva UMA mensagem curta de follow-up (no máximo 2 linhas), natural e educada, retomando o ponto exato em que a conversa parou e terminando com uma pergunta simples.",
    "Não repita a sua última mensagem, não pressione, não cite nome de ninguém da Valora, não use ferramentas nem marcadores, e não diga que é uma mensagem automática."
  ].join(" ");
}

async function followUpDaConversa(ticket: Ticket, agora: Date): Promise<boolean> {
  if (!ticket.lastInboundAt) return false;
  const ultimaDoLead = new Date(ticket.lastInboundAt);
  if (!deveMandarFollowUp(ultimaDoLead, agora)) return false;
  if (ETAPAS_SEM_FOLLOW_UP.has(String(ticket.salesStage || ""))) return false;
  if (ticket.aiPausedUntil && new Date(ticket.aiPausedUntil) > agora) return false;
  if (!dentroDaJanela(ticket)) return false;

  const chave = `followup:${ticket.id}:${ultimaDoLead.getTime()}`;
  if (await cacheLayer.get(chave)) return false;

  const cfg = await escopoDeVendas(ticket);
  if (!cfg || !cfg.enabled) return false;
  const ultima = await Message.findOne({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]] });
  // Lead falou por último: ele espera resposta, não follow-up.
  if (!ultima || !ultima.fromMe) return false;
  const contato = await Contact.findByPk(ticket.contactId);
  if (!contato) return false;
  // As mesmas travas da resposta normal: pausa, atendente, limites, loop.
  const decisao = await decidir(ticket, contato, cfg);
  if (!decisao.reply) return false;

  const recentes = (
    await Message.findAll({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]], limit: 12 })
  ).reverse();
  const { history } = separarTurnoAtual(recentes);
  const horas = Math.round((agora.getTime() - ultimaDoLead.getTime()) / 3600000);
  const resposta = await generateBotReply({
    persona: await promptDeVendas(cfg, ticket.salesSource),
    knowledge: "",
    history,
    userMessage: instrucaoDoFollowUp(horas),
    contactName: contato.name,
    files: [],
    provedores: await provedoresDaEmpresa(ticket.companyId)
  });
  // Modelo fora ou pedido de passagem: no follow-up, melhor não mandar nada.
  if (!resposta || resposta.kind !== "reply") return false;
  const texto = extrairMarcadoresDeVendas(resposta.text).texto;
  if (!texto) return false;
  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId);
  if (!whatsapp) return false;

  // Marca antes de enviar: duas varreduras nunca mandam dois follow-ups.
  await cacheLayer.set(chave, "1", "EX", TRES_DIAS_S);
  const { wamid } = await sendText(whatsapp, contato.number, texto);
  await CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: contato.id,
      body: texto,
      fromMe: true,
      read: true,
      ack: 1,
      channel: CHANNEL,
      sentBy: "ai"
    } as any,
    companyId: ticket.companyId
  });
  logger.info(`[val-follow-up] ticket ${ticket.id}: enviado após ${horas}h de silêncio`);
  return true;
}

/** Uma varredura: conversas da Val no Oficial com o lead calado entre 8h e 23,5h. */
export async function varrerFollowUps(agora: Date = new Date()): Promise<number> {
  const tickets = await Ticket.findAll({
    where: {
      channel: CHANNEL,
      status: { [Op.in]: ["open", "pending"] },
      salesSource: { [Op.ne]: null },
      userId: null,
      lastInboundAt: {
        [Op.between]: [new Date(agora.getTime() - FIM_DA_JANELA_MS), new Date(agora.getTime() - SILENCIO_MINIMO_MS)]
      }
    } as any,
    limit: 300
  });
  let enviados = 0;
  for (const ticket of tickets) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await followUpDaConversa(ticket, agora)) enviados += 1;
    } catch (err: any) {
      logger.error({ ticketId: ticket.id, err: err?.message }, "[val-follow-up] falhou nesta conversa");
    }
  }
  return enviados;
}

let rodando = false;

/** A cada 10 minutos. Uma varredura por vez. */
export function iniciarFollowUpNaJanela(): void {
  const job = new CronJob("0 */10 * * * *", async () => {
    if (rodando) return;
    rodando = true;
    try {
      const n = await varrerFollowUps();
      if (n) logger.info(`[val-follow-up] ${n} follow-up(s) enviado(s)`);
    } catch (err: any) {
      logger.error({ err: err?.message }, "[val-follow-up] varredura falhou");
    } finally {
      rodando = false;
    }
  });
  job.start();
  logger.info("[val-follow-up] varredura a cada 10 minutos ligada");
}
