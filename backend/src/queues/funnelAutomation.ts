import Queue from "bull";
import Company from "../models/Company";
import Contact from "../models/Contact";
import FunnelAction from "../models/FunnelAction";
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
  decidirExecucao
} from "../services/TagServices/funnelActionRules";

/**
 * Automação do funil: o card entra numa lista (ou chega conversa nova) e o CRM
 * executa a lista de ações configurada.
 *
 * Fila própria (e não a `messageQueue` geral) por segurança do número: disparo
 * automático é o que queima conta de WhatsApp, e aqui ele fica atrás de um
 * limitador que não afeta a conversa que um atendente está tocando na mão.
 */
const connection = process.env.REDIS_URI || "";

/** Teto conservador de disparos automáticos: 1 a cada 5s por instância. */
const LIMITE_MAX = Number(process.env.TAG_AUTOMATION_LIMITER_MAX || 1);
const LIMITE_DURACAO = Number(
  process.env.TAG_AUTOMATION_LIMITER_DURATION || 5000
);

/** Reavaliação quando a mensagem cai fora do expediente. */
const ESPERA_FORA_DO_EXPEDIENTE_MS = 15 * 60 * 1000;
/** Depois disto a mensagem é descartada em vez de perseguir o contato por dias. */
const MAX_POSTERGACOES = 192; // 48h em janelas de 15 min

export const funnelAutomationQueue = new Queue(
  "FunnelAutomationQueue",
  connection,
  { limiter: { max: LIMITE_MAX, duration: LIMITE_DURACAO } }
);

interface DadosDaExecucao {
  runId: number;
  actionId: number;
  postergacoes?: number;
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

/** Liga ou desliga o bot NESTA conversa. Estado interno: não fala com ninguém. */
async function aplicarBot(ticketId: number, ligado: boolean): Promise<void> {
  await Ticket.update({ aiBotEnabled: ligado } as any, {
    where: { id: ticketId }
  });
  logger.info(
    `[funnel] bot ${ligado ? "ligado" : "desligado"} ticket=${ticketId}`
  );
}

/**
 * Decide e agenda as ações de um evento do funil.
 *
 * `tagId` nulo = conversa nova (a coluna "Entrada"). Nunca lança: falha de
 * automação não pode impedir alguém de mover um card nem barrar uma mensagem
 * que está chegando.
 */
export async function agendarAcoesDoFunil(
  ticketId: number,
  tagId: number | null,
  companyId: number
): Promise<void> {
  try {
    const acoes = await FunnelAction.findAll({
      where: { companyId, tagId, ativo: true } as any,
      order: [["ordem", "ASC"]]
    });
    if (acoes.length === 0) return;

    for (const acao of acoes) {
      // `umaVezSo` é por AÇÃO, não por lista: uma lista pode mandar a mensagem
      // uma vez só e ligar o bot toda vez que o card voltar.
      const ultimoDisparo = await TagAutomationRun.findOne({
        where: { ticketId, actionId: acao.id } as any,
        order: [["createdAt", "DESC"]]
      });

      const decisao = decidirAgendamento(acao as any, companyId, ultimoDisparo);
      if (decisao.agendar === false) {
        logger.debug(
          `[funnel] nada a fazer ticket=${ticketId} acao=${acao.id}: ${decisao.motivo}`
        );
        continue;
      }

      const run = await TagAutomationRun.create({
        ticketId,
        tagId,
        actionId: acao.id,
        companyId
      } as any);

      if (decisao.imediato) {
        // Ação silenciosa sem atraso: roda agora, fora da fila. É o que faz o
        // bot responder a PRIMEIRA mensagem de uma conversa nova.
        await executar(run.id, acao.id, 0);
        continue;
      }

      await funnelAutomationQueue.add(
        "Executar",
        { runId: run.id, actionId: acao.id } as DadosDaExecucao,
        {
          delay: Math.max(0, acao.atrasoMinutos || 0) * 60 * 1000,
          removeOnComplete: true
        }
      );
      logger.info(
        `[funnel] agendado ticket=${ticketId} acao=${acao.id} tipo=${acao.tipo} atraso=${acao.atrasoMinutos}min`
      );
    }
  } catch (err: any) {
    logger.error(
      `[funnel] falha ao agendar ticket=${ticketId} tag=${tagId}: ${err?.message}`
    );
  }
}

async function executar(
  runId: number,
  actionId: number,
  postergacoes: number
): Promise<void> {
  const run = await TagAutomationRun.findByPk(runId);
  if (!run || run.sentAt || run.skippedReason) return;

  const acao = await FunnelAction.findByPk(actionId);
  if (!acao) {
    await run.update({ skippedReason: "ação não existe mais" } as any);
    return;
  }

  const ticket = await Ticket.findByPk(run.ticketId, {
    include: [
      { model: Contact, as: "contact" },
      { model: QueueModel, as: "queue" },
      { model: User, as: "user" }
    ]
  });
  if (!ticket) {
    await run.update({ skippedReason: "conversa não existe mais" } as any);
    return;
  }

  // Automação de conversa nova não pertence a lista nenhuma.
  const exigeLista = acao.tagId !== null && acao.tagId !== undefined;
  const aindaNaLista = exigeLista
    ? !!(await TicketTag.findOne({
        where: { ticketId: run.ticketId, tagId: acao.tagId }
      }))
    : true;

  const respeitaExpediente = !!acao.soHorarioComercial;
  const decisao = decidirExecucao({
    tipo: acao.tipo,
    aindaNaLista,
    exigeLista,
    respeitaExpediente,
    // Só consulta o expediente quando a regra pede — evita ida ao banco à toa.
    dentroDoExpediente:
      respeitaExpediente && acao.tipo === "mensagem"
        ? await dentroDoExpediente(run.companyId)
        : true,
    postergacoes,
    maxPostergacoes: MAX_POSTERGACOES
  });

  if (decisao.acao === "descartar") {
    await run.update({ skippedReason: decisao.motivo } as any);
    logger.info(`[funnel] cancelado run=${runId}: ${decisao.motivo}`);
    return;
  }

  if (decisao.acao === "postergar") {
    await funnelAutomationQueue.add(
      "Executar",
      { runId, actionId, postergacoes: postergacoes + 1 } as DadosDaExecucao,
      { delay: ESPERA_FORA_DO_EXPEDIENTE_MS, removeOnComplete: true }
    );
    return;
  }

  try {
    if (acao.tipo === "bot_ligar" || acao.tipo === "bot_desligar") {
      await aplicarBot(ticket.id, acao.tipo === "bot_ligar");
      await run.update({ sentAt: new Date() } as any);
      return;
    }

    // mensagem
    const whatsapp =
      (ticket.whatsappId ? await Whatsapp.findByPk(ticket.whatsappId) : null) ||
      (await GetDefaultWhatsApp(run.companyId));
    if (!whatsapp) {
      await run.update({
        skippedReason: "sem conexão de WhatsApp disponível"
      } as any);
      return;
    }

    await SendMessage(whatsapp, {
      number: ticket.contact.number,
      body: formatBody(String(acao.config?.mensagem ?? ""), ticket),
      // Grava na conversa: o atendente precisa ver o que saiu sem ele digitar.
      saveOnTicket: ticket.id
    });
    await run.update({ sentAt: new Date() } as any);
    logger.info(
      `[funnel] enviado ticket=${ticket.id} acao=${acao.id} contato=${ticket.contact.name}`
    );
  } catch (err: any) {
    await run.update({ skippedReason: `falha: ${err?.message}` } as any);
    logger.error(`[funnel] falha run=${runId}: ${err?.message}`);
  }
}

/**
 * Desliga o bot quando o card sai de uma lista que o havia ligado.
 *
 * Decisão do Hélio: "o bot atende enquanto o card estiver naquela lista".
 * Mover para "Negociação", onde um humano assume, tem de calar o bot — bot
 * respondendo por cima do atendente é o erro que o cliente percebe na hora.
 */
export async function desligarBotAoSairDaLista(
  ticketId: number,
  tagId: number,
  companyId: number
): Promise<void> {
  try {
    const ligavaOBot = await FunnelAction.findOne({
      where: { companyId, tagId, tipo: "bot_ligar", ativo: true } as any
    });
    if (!ligavaOBot) return;
    await aplicarBot(ticketId, false);
  } catch (err: any) {
    logger.error(
      `[funnel] falha ao desligar bot ticket=${ticketId}: ${err?.message}`
    );
  }
}

export function startFunnelAutomationQueue(): void {
  funnelAutomationQueue.process("Executar", (job: { data: DadosDaExecucao }) =>
    executar(job.data.runId, job.data.actionId, job.data.postergacoes ?? 0)
  );
}
