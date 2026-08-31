import Queue from "bull";
import Company from "../models/Company";
import Contact from "../models/Contact";
import Tag from "../models/Tag";
import TagAutomationRun from "../models/TagAutomationRun";
import Ticket from "../models/Ticket";
import TicketTag from "../models/TicketTag";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import QueueModel from "../models/Queue";
import GetDefaultWhatsApp from "../helpers/GetDefaultWhatsApp";
import { SendMessage } from "../helpers/SendMessage";
import formatBody from "../helpers/Mustache";
import { checkOpenHours } from "../helpers/checkOpenHours";
import { logger } from "../utils/logger";
import {
  decidirAgendamento,
  decidirEnvio
} from "../services/TagServices/tagAutomationRules";

/**
 * Gatilho de lista do funil: card entrou na lista X, o CRM manda a mensagem Y.
 *
 * Fila própria (e não a `messageQueue` geral) por um motivo de segurança do
 * número: disparo automático é o que queima conta de WhatsApp, e aqui ele fica
 * atrás de um limitador que não afeta a conversa que um atendente está tocando
 * na mão.
 */
const connection = process.env.REDIS_URI || "";

/** Teto conservador de disparos automáticos: 1 a cada 5s por instância. */
const LIMITE_MAX = Number(process.env.TAG_AUTOMATION_LIMITER_MAX || 1);
const LIMITE_DURACAO = Number(process.env.TAG_AUTOMATION_LIMITER_DURATION || 5000);

/** Reavaliação quando a mensagem cai fora do expediente. */
const ESPERA_FORA_DO_EXPEDIENTE_MS = 15 * 60 * 1000;
/** Depois disto a mensagem é descartada em vez de perseguir o contato por dias. */
const MAX_POSTERGACOES = 192; // 48h em janelas de 15 min

export const tagAutomationQueue = new Queue("TagAutomationQueue", connection, {
  limiter: { max: LIMITE_MAX, duration: LIMITE_DURACAO }
});

interface DadosDoDisparo {
  runId: number;
  /** Quantas vezes já foi adiado por estar fora do expediente. */
  postergacoes?: number;
}

/**
 * Decide se o card entrando na lista dispara mensagem e, em caso positivo,
 * enfileira.
 *
 * Chamado de `ticketTagAdd`, que é o ponto ÚNICO por onde um card entra numa
 * lista — pela tela, pelo bot ou por qualquer outro caminho. Nunca lança: falha
 * de automação não pode impedir alguém de mover um card.
 */
export async function agendarGatilhoDeLista(
  ticketId: number,
  tagId: number,
  companyId: number
): Promise<void> {
  try {
    const tag = await Tag.findByPk(tagId);

    const ultimoDisparo = tag
      ? await TagAutomationRun.findOne({
          where: { ticketId, tagId },
          order: [["createdAt", "DESC"]]
        })
      : null;

    const decisao = decidirAgendamento(tag, companyId, ultimoDisparo);
    if (decisao.agendar === false) {
      logger.debug(
        `[tag-automation] nada a fazer ticket=${ticketId} tag=${tagId}: ${decisao.motivo}`
      );
      return;
    }

    const run = await TagAutomationRun.create({
      ticketId,
      tagId,
      companyId
    } as any);

    await tagAutomationQueue.add(
      "Disparar",
      { runId: run.id } as DadosDoDisparo,
      {
        delay: Math.max(0, tag.autoDelayMinutes || 0) * 60 * 1000,
        removeOnComplete: true
      }
    );

    logger.info(
      `[tag-automation] agendado ticket=${ticketId} lista=${tag.name} atraso=${tag.autoDelayMinutes}min`
    );
  } catch (err: any) {
    logger.error(
      `[tag-automation] falha ao agendar ticket=${ticketId} tag=${tagId}: ${err?.message}`
    );
  }
}

/** Empresa sem expediente cadastrado é tratada como sempre aberta. */
async function dentroDoExpediente(companyId: number): Promise<boolean> {
  const company = await Company.findByPk(companyId);
  const horarios = company?.schedules as any;
  if (!horarios?.timezone || !horarios?.weeklyRules?.length) return true;
  try {
    return checkOpenHours(horarios);
  } catch {
    // Configuração de horário estranha não pode segurar a mensagem para sempre.
    return true;
  }
}

async function processarDisparo(job: { data: DadosDoDisparo }): Promise<void> {
  const { runId, postergacoes = 0 } = job.data;

  const run = await TagAutomationRun.findByPk(runId);
  if (!run || run.sentAt || run.skippedReason) return;

  const tag = await Tag.findByPk(run.tagId);
  const ticket = await Ticket.findByPk(run.ticketId, {
    include: [
      { model: Contact, as: "contact" },
      { model: QueueModel, as: "queue" },
      { model: User, as: "user" }
    ]
  });
  if (!ticket) {
    await run.update({ skippedReason: "conversa não existe mais" });
    return;
  }

  // O card pode ter saído da lista durante a espera.
  const aindaNaLista = await TicketTag.findOne({
    where: { ticketId: run.ticketId, tagId: run.tagId }
  });

  const respeitaExpediente = !!tag?.autoBusinessHoursOnly;
  const decisao = decidirEnvio({
    aindaNaLista: !!aindaNaLista,
    temMensagem: !!tag?.autoMessage?.trim(),
    respeitaExpediente,
    // Só consulta o expediente quando a regra pede — evita ida ao banco à toa.
    dentroDoExpediente: respeitaExpediente
      ? await dentroDoExpediente(run.companyId)
      : true,
    postergacoes,
    maxPostergacoes: MAX_POSTERGACOES
  });

  if (decisao.acao === "descartar") {
    await run.update({ skippedReason: decisao.motivo });
    logger.info(`[tag-automation] cancelado run=${runId}: ${decisao.motivo}`);
    return;
  }

  if (decisao.acao === "postergar") {
    await tagAutomationQueue.add(
      "Disparar",
      { runId, postergacoes: postergacoes + 1 } as DadosDoDisparo,
      { delay: ESPERA_FORA_DO_EXPEDIENTE_MS, removeOnComplete: true }
    );
    return;
  }

  const whatsapp =
    (ticket.whatsappId ? await Whatsapp.findByPk(ticket.whatsappId) : null) ||
    (await GetDefaultWhatsApp(run.companyId));
  if (!whatsapp) {
    await run.update({ skippedReason: "sem conexão de WhatsApp disponível" });
    return;
  }

  try {
    await SendMessage(whatsapp, {
      number: ticket.contact.number,
      body: formatBody(tag.autoMessage, ticket),
      // Grava na conversa: o atendente precisa ver o que saiu sem ele digitar.
      saveOnTicket: ticket.id
    });
    await run.update({ sentAt: new Date() });
    logger.info(
      `[tag-automation] enviado ticket=${ticket.id} lista=${tag.name} contato=${ticket.contact.name}`
    );
  } catch (err: any) {
    await run.update({ skippedReason: `falha no envio: ${err?.message}` });
    logger.error(
      `[tag-automation] falha no envio run=${runId}: ${err?.message}`
    );
  }
}

export function startTagAutomationQueue(): void {
  tagAutomationQueue.process("Disparar", processarDisparo);
}
