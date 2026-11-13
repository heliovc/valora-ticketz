import { Op } from "sequelize";
import { CronJob } from "cron";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { cacheLayer } from "../../libs/cache";
import { generateBotReply } from "../../helpers/aiBot";
import { separarTurnoAtual } from "../../helpers/aiBotTurn";
import {
  ESPERA_FOLLOW_UP_1_MS,
  FollowUpsJaFeitos,
  JANELA_MS,
  HORIZONTE_QR_MS,
  MAX_FOLLOW_UPS,
  MAX_FOLLOW_UPS_QR,
  followUpsJaFeitos,
  proximoFollowUp,
  proximoFollowUpQr
} from "../../helpers/followUpNaJanela";
import { soRespostaAutomatica } from "../../helpers/respostaAutomatica";
import { logger } from "../../utils/logger";
import { provedoresDaEmpresa } from "../AiBotServices/AiBotProvidersService";
import { CHANNEL } from "../CloudApiServices/CloudApiChannel";
import { dentroDaJanela, sendText } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { decidir, escopoDeVendas, promptDeVendas } from "./SalesAiService";
import { seguePorEmail } from "./MaterialPorEmail";
import { TRIAGEM, extrairMarcadoresDeVendas } from "./salesAiRules";

/**
 * Follow-ups da Val no WhatsApp Oficial, dentro da janela de 24h (pedido do
 * Hélio em 10/11/2026: "precisam ser enviados antes da janela de 24 horas para
 * não pagarmos"). Até 3 por silêncio do lead — 2h depois da IA, 10h depois do
 * 1º e antes de a janela fechar —, só em horário comercial (seg a sex, 9h às
 * 18h). Regra em
 * `helpers/followUpNaJanela.ts`.
 *
 * Vale para quem RESPONDEU e depois ficou em silêncio, com a nossa mensagem por
 * último. Quem nunca respondeu não tem janela aberta: só sairia modelo pago, e
 * a abertura já foi. O lead respondeu no meio: volta ao 1. A própria Val
 * escreve, retomando o ponto em que a conversa parou.
 *
 * Lembrete escrito à mão pela equipe conta como follow-up feito, e a Val lê a
 * conversa antes de cada um: se não couber (o lead pediu prazo, recusou,
 * negocia com a equipe…), ela responde [[SEM_FOLLOW_UP]] e não manda nada
 * (Hélio, 12/11/2026).
 */
const ETAPAS_SEM_FOLLOW_UP = new Set(["sem_interesse", "transferido"]);

/**
 * Conexão por QR (Baileys), o "funil principal". Pedido do Hélio em 12/11/2026:
 * a Val ligada no card do QR também faz follow-up. Lá não há janela paga da
 * Meta, então a cadência é longa (13/11/2026, caso Claudio): 2h, dia útil
 * seguinte, +3 dias úteis e +1 semana — ver `proximoFollowUpQr`.
 */
export const CANAL_QR = "whatsapp";

/** Última mensagem do lead: no Oficial é a que abre a janela; no QR, a última que chegou. */
export function ultimaDoLeadDe(ticket: Pick<Ticket, "channel" | "lastInboundAt" | "lastClientMessageAt">): Date | null {
  const marca = ticket.channel === CHANNEL ? ticket.lastInboundAt : ticket.lastClientMessageAt;
  return marca ? new Date(marca) : null;
}
/** A contagem do silêncio vive o bastante para a cadência do QR (cerca de duas semanas). */
const VALIDADE_DA_CONTAGEM_S = 30 * 24 * 60 * 60;

export type NumeroDoFollowUp = 1 | 2 | 3 | 4;

const TOM = {
  primeiro: "É o primeiro lembrete: retome o ponto exato em que a conversa parou e termine com uma pergunta simples.",
  segundo: "É o segundo lembrete: traga um benefício concreto ou uma pergunta diferente da anterior, sem repetir o primeiro lembrete.",
  terceiro: "É o terceiro lembrete: traga um benefício concreto ou um exemplo prático que ainda não apareceu na conversa, sem repetir os lembretes anteriores.",
  ultimo: "É o último lembrete: diga em tom leve que fica à disposição e deixe uma pergunta simples para ele retomar quando quiser."
};

/** Oficial: 1, 2 e o último (3). QR: 1, 2, 3 e o último (4). */
export function tomDoFollowUp(numero: NumeroDoFollowUp, qr: boolean): string {
  if (numero === 1) return TOM.primeiro;
  if (numero === 2) return TOM.segundo;
  if (numero === 3) return qr ? TOM.terceiro : TOM.ultimo;
  return TOM.ultimo;
}

/** "3 horas", "2 dias". */
function tempoDeSilencio(horas: number): string {
  if (horas < 48) return `${horas} hora${horas === 1 ? "" : "s"}`;
  const dias = Math.round(horas / 24);
  return `${dias} dias`;
}

/** A IA leu a conversa e concluiu que não cabe lembrete agora. */
export const SEM_FOLLOW_UP = /\[\[\s*SEM[_ ]FOLLOW[_ -]?UP\s*\]\]/i;

export function instrucaoDoFollowUp(numero: NumeroDoFollowUp, horas: number, feitos?: FollowUpsJaFeitos, qr = false): string {
  const jaFeitos =
    feitos && feitos.quantos > 0
      ? `Desde a última mensagem do lead já saiu${feitos.quantos > 1 ? "ram" : ""} ${feitos.quantos} lembrete${feitos.quantos > 1 ? "s" : ""} nosso${feitos.quantos > 1 ? "s" : ""}${feitos.ultimoPelaEquipe ? ", o último escrito à mão por alguém da equipe" : ""}. Algumas mensagens "suas" no histórico podem ter sido escritas pela equipe: trate-as como suas e não repita o que já foi dito.`
      : 'Algumas mensagens "suas" no histórico podem ter sido escritas à mão pela equipe: trate-as como suas e não repita o que já foi dito.';
  return [
    `[SISTEMA] O lead não responde à nossa última mensagem há cerca de ${tempoDeSilencio(horas)}.`,
    jaFeitos,
    "ANTES de escrever, leia a conversa inteira. Se não couber lembrete agora — o lead disse que vai pensar ou que retorna depois, pediu um prazo, pediu para seguir por e-mail ou passou um e-mail, recusou, já tem reunião ou demonstração marcada, está negociando valores com a equipe, ou a conversa foi encerrada —, responda APENAS [[SEM_FOLLOW_UP]].",
    `Se couber, escreva UMA mensagem curta de follow-up (no máximo 2 linhas), natural e educada. ${tomDoFollowUp(numero, qr)}`,
    "Não repita mensagens anteriores, não pressione, não cite nome de ninguém da Valora, não use ferramentas nem marcadores (exceto [[SEM_FOLLOW_UP]]), e não diga que é uma mensagem automática."
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
  const oficial = ticket.channel === CHANNEL;
  const ultimaDoLead = ultimaDoLeadDe(ticket);
  if (!ultimaDoLead) return false;
  if (ETAPAS_SEM_FOLLOW_UP.has(String(ticket.salesStage || ""))) return false;
  if (ticket.aiPausedUntil && new Date(ticket.aiPausedUntil) > agora) return false;
  // O lead pediu para seguir por e-mail e a apresentação já foi: sem lembrete aqui.
  if (await seguePorEmail(ticket.id)) return false;
  // Só o Oficial tem janela da Meta; o QR segue a cadência longa de `proximoFollowUpQr`.
  if (oficial && !dentroDaJanela(ticket)) return false;

  const chave = `followup:${ticket.id}:${ultimaDoLead.getTime()}`;
  const contagem = await lerContagem(chave);
  const maximo = oficial ? MAX_FOLLOW_UPS : MAX_FOLLOW_UPS_QR;
  if (contagem.n >= maximo) return false;

  const cfg = await escopoDeVendas(ticket);
  if (!cfg || !cfg.enabled) return false;
  const ultima = await Message.findOne({ where: { ticketId: ticket.id }, order: [["createdAt", "DESC"]] });
  // Lead falou por último: ele espera resposta, não follow-up.
  if (!ultima || !ultima.fromMe) return false;
  // Do outro lado só o robô da casa (boas-vindas, menu, horário): a Val já deixou
  // o recado uma vez, como manda a playbook. Lembrete para robô não (11/11/2026).
  const conversa = await Message.findAll({
    where: { ticketId: ticket.id },
    attributes: ["fromMe", "body", "createdAt", "sentBy"],
    order: [["createdAt", "DESC"]],
    limit: 30
  });
  if (soRespostaAutomatica(conversa)) return false;
  // Lembretes que já saíram neste silêncio, inclusive os escritos à mão pela
  // equipe (Hélio, 12/11/2026): a contagem da Val sozinha não sabe deles.
  const feitos = followUpsJaFeitos(conversa as any, ultimaDoLead);
  const enviados = Math.max(contagem.n, feitos.quantos);
  if (enviados >= maximo) return false;
  const ultimoFollowUpEm =
    [contagem.em, feitos.ultimoEm].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] || null;
  const estado = { ultimaDoLead, ultimaNossa: new Date(ultima.createdAt), enviados, ultimoFollowUpEm };
  const numero = oficial ? proximoFollowUp(estado, agora) : proximoFollowUpQr(estado, agora);
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
    userMessage: instrucaoDoFollowUp(numero, horas, feitos, !oficial),
    contactName: contato.name,
    files: [],
    provedores: await provedoresDaEmpresa(ticket.companyId),
    uso: { companyId: ticket.companyId, ticketId: ticket.id, origem: "follow_up", canal: oficial ? "oficial" : "qr" }
  });
  // Modelo fora ou pedido de passagem: no follow-up, melhor não mandar nada.
  if (!resposta || resposta.kind !== "reply") return false;
  // Leu a conversa e viu que não cabe lembrete: encerra este silêncio sem mandar
  // nada (e sem perguntar de novo ao modelo a cada varredura).
  if (SEM_FOLLOW_UP.test(resposta.text || "")) {
    await cacheLayer.set(chave, JSON.stringify({ n: maximo, em: agora.toISOString() }), "EX", VALIDADE_DA_CONTAGEM_S);
    logger.info(`[val-follow-up] ticket ${ticket.id}: a IA leu a conversa e decidiu não mandar o follow-up ${numero}`);
    return false;
  }
  const texto = extrairMarcadoresDeVendas(resposta.text).texto;
  if (!texto) return false;
  const whatsapp = await Whatsapp.findByPk(ticket.whatsappId);
  if (!whatsapp) return false;
  // QR desconectado: não marca nem envia — a próxima varredura tenta de novo.
  if (!oficial && whatsapp.status && whatsapp.status !== "CONNECTED") return false;

  // Marca antes de enviar: duas varreduras nunca mandam o mesmo follow-up duas vezes.
  await cacheLayer.set(chave, JSON.stringify({ n: numero, em: agora.toISOString() }), "EX", VALIDADE_DA_CONTAGEM_S);
  if (!oficial) {
    // O envio pelo Baileys lê o número em `ticket.contact`, que a varredura não
    // carrega (13/11/2026: o 2º lembrete do Claudio falhou com "reading 'number'").
    ticket.contact = contato;
    // QR: o Baileys grava a mensagem quando ela volta pelo listener, como a resposta da Val.
    await SendWhatsAppMessage({ body: texto, ticket, sentBy: "ai" });
    logger.info(`[val-follow-up] ticket ${ticket.id} (QR): follow-up ${numero} enviado após ${horas}h de silêncio do lead`);
    return true;
  }
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

/**
 * Uma varredura: conversas da Val no Oficial (janela aberta: lead calado há
 * 2h a 24h) e no QR (lead calado há 2h a 21 dias).
 */
export async function varrerFollowUps(agora: Date = new Date()): Promise<number> {
  const ate = new Date(agora.getTime() - ESPERA_FOLLOW_UP_1_MS);
  const entre = { [Op.between]: [new Date(agora.getTime() - JANELA_MS), ate] };
  const entreNoQr = { [Op.between]: [new Date(agora.getTime() - HORIZONTE_QR_MS), ate] };
  const tickets = await Ticket.findAll({
    where: {
      status: { [Op.in]: ["open", "pending"] },
      // Triagem fica fora: sem produto, não há playbook para o follow-up.
      salesSource: { [Op.ne]: null, [Op.notIn]: [TRIAGEM] },
      userId: null,
      isGroup: false,
      [Op.or]: [
        { channel: CHANNEL, lastInboundAt: entre },
        { channel: CANAL_QR, lastClientMessageAt: entreNoQr }
      ]
    } as any,
    order: [["updatedAt", "DESC"]],
    limit: 500
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
