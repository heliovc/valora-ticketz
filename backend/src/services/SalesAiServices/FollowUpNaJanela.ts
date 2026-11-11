import { Op } from "sequelize";
import { CronJob } from "cron";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { cacheLayer } from "../../libs/cache";
import { generateBotReply } from "../../helpers/aiBot";
import { separarTurnoAtual } from "../../helpers/aiBotTurn";
import { ESPERA_FOLLOW_UP_1_MS, JANELA_MS, MAX_FOLLOW_UPS, proximoFollowUp } from "../../helpers/followUpNaJanela";
import { logger } from "../../utils/logger";
import { provedoresDaEmpresa } from "../AiBotServices/AiBotProvidersService";
import { CHANNEL } from "../CloudApiServices/CloudApiChannel";
import { dentroDaJanela, sendText } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { decidir, escopoDeVendas, promptDeVendas } from "./SalesAiService";
import { extrairMarcadoresDeVendas } from "./salesAiRules";

/**
 * Follow-ups da Val no WhatsApp Oficial, dentro da janela de 24h (pedido do
 * Hélio em 10/11/2026: "precisam ser enviados antes da janela de 24 horas para
 * não pagarmos"). Até 3 por silêncio do lead — 2h depois da IA, 10h depois do
 * 1º e antes de a janela fechar —, nunca entre 22h e 8h. Regra em
 * `helpers/followUpNaJanela.ts`.
 *
 * Vale para quem RESPONDEU e depois ficou em silêncio, com a nossa mensagem por
 * último. Quem nunca respondeu não tem janela aberta: só sairia modelo pago, e
 * a abertura já foi. O lead respondeu no meio: volta ao 1. A própria Val
 * escreve, retomando o ponto em que a conversa parou.
 */
const ETAPAS_SEM_FOLLOW_UP = new Set(["sem_interesse", "transferido"]);
const TRES_DIAS_S = 3 * 24 * 60 * 60;

const TOM_DO_FOLLOW_UP: Record<1 | 2 | 3, string> = {
  1: "É o primeiro lembrete: retome o ponto exato em que a conversa parou e termine com uma pergunta simples.",
  2: "É o segundo lembrete: traga um benefício concreto ou uma pergunta diferente da anterior, sem repetir o primeiro lembrete.",
  3: "É o último lembrete: diga em tom leve que fica à disposição e deixe uma pergunta simples para ele retomar quando quiser."
};

export function instrucaoDoFollowUp(numero: 1 | 2 | 3, horas: number): string {
  return [
    `[SISTEMA] O lead não responde à sua última mensagem há cerca de ${horas} hora${horas === 1 ? "" : "s"}.`,
    `Escreva UMA mensagem curta de follow-up (no máximo 2 linhas), natural e educada. ${TOM_DO_FOLLOW_UP[numero]}`,
    "Não repita mensagens anteriores, não pressione, não cite nome de ninguém da Valora, não use ferramentas nem marcadores, e não diga que é uma mensagem automática."
  ].join(" ");
}

/** Follow-ups já enviados neste silêncio do lead (chave = conversa + última mensagem dele). */
async function lerContagem(chave: string): Promise<{ n: number; em: Date | null }> {
  const bruto = await cacheLayer.get(chave);
  if (!bruto) return { n: 0, em: null };
  // Formato antigo ("1", até 10/11/2026): o follow-up único já saiu — este silêncio está encerrado.
  let v: any = null;
  try {
    v = JSON.parse(bruto);
  } catch {
    v = null;
  }
  if (!v || typeof v !== "object") return { n: MAX_FOLLOW_UPS, em: null };
  return { n: Number(v.n) || 0, em: v.em ? new Date(v.em) : null };
}

async function followUpDaConversa(ticket: Ticket, agora: Date): Promise<boolean> {
  if (!ticket.lastInboundAt) return false;
  const ultimaDoLead = new Date(ticket.lastInboundAt);
  if (ETAPAS_SEM_FOLLOW_UP.has(String(ticket.salesStage || ""))) return false;
  if (ticket.aiPausedUntil && new Date(ticket.aiPausedUntil) > agora) return false;
  if (!dentroDaJanela(ticket)) return false;

  const chave = `followup:${ticket.id}:${ultimaDoLead.getTime()}`;
  const contagem = await lerContagem(chave);
  if (contagem.n >= MAX_FOLLOW_UPS) return false;

  const cfg = await escopoDeVendas(ticket);
  if (!cfg || !cfg.enabled) return false;
  const ultima = await Message.findOne({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]] });
  // Lead falou por último: ele espera resposta, não follow-up.
  if (!ultima || !ultima.fromMe) return false;
  const numero = proximoFollowUp(
    { ultimaDoLead, ultimaNossa: new Date(ultima.createdAt), enviados: contagem.n, ultimoFollowUpEm: contagem.em },
    agora
  );
  if (!numero) return false;
  const contato = await Contact.findByPk(ticket.contactId);
  if (!contato) return false;
  // As mesmas travas da resposta normal: pausa, atendente, limites, loop.
  const decisao = await decidir(ticket, contato, cfg);
  if (!decisao.reply) return false;

  const recentes = (
    await Message.findAll({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]], limit: 12 })
  ).reverse();
  const { history } = separarTurnoAtual(recentes);
  const horas = Math.max(1, Math.round((agora.getTime() - new Date(ultima.createdAt).getTime()) / 3600000));
  const resposta = await generateBotReply({
    persona: await promptDeVendas(cfg, ticket.salesSource, ticket.contactId),
    knowledge: "",
    history,
    userMessage: instrucaoDoFollowUp(numero, horas),
    contactName: contato.name,
    files: [],
    provedores: await provedoresDaEmpresa(ticket.companyId),
    uso: { companyId: ticket.companyId, ticketId: ticket.id, origem: "follow_up", canal: "oficial" }
  });
  // Modelo fora ou pedido de passagem: no follow-up, melhor não mandar nada.
  if (!resposta || resposta.kind !== "reply") return false;
  const texto = extrairMarcadoresDeVendas(resposta.text).texto;
  if (!texto) return false;
  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId);
  if (!whatsapp) return false;

  // Marca antes de enviar: duas varreduras nunca mandam o mesmo follow-up duas vezes.
  await cacheLayer.set(chave, JSON.stringify({ n: numero, em: agora.toISOString() }), "EX", TRES_DIAS_S);
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
  logger.info(`[val-follow-up] ticket ${ticket.id}: follow-up ${numero} enviado após ${horas}h de silêncio do lead`);
  return true;
}

/** Uma varredura: conversas da Val no Oficial com a janela aberta e o lead calado há pelo menos 2h. */
export async function varrerFollowUps(agora: Date = new Date()): Promise<number> {
  const tickets = await Ticket.findAll({
    where: {
      channel: CHANNEL,
      status: { [Op.in]: ["open", "pending"] },
      salesSource: { [Op.ne]: null },
      userId: null,
      lastInboundAt: {
        [Op.between]: [new Date(agora.getTime() - JANELA_MS), new Date(agora.getTime() - ESPERA_FOLLOW_UP_1_MS)]
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
