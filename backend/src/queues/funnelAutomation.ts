import Queue from "bull";
import { Op } from "sequelize";
import Company from "../models/Company";
import Contact from "../models/Contact";
import FunnelAction from "../models/FunnelAction";
import Tag from "../models/Tag";
import TagAutomationRun from "../models/TagAutomationRun";
import Ticket from "../models/Ticket";
import Message from "../models/Message";
import TicketNote from "../models/TicketNote";
import TicketTag from "../models/TicketTag";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import QueueModel from "../models/Queue";
import GetDefaultWhatsApp from "../helpers/GetDefaultWhatsApp";
import { SendMessage } from "../helpers/SendMessage";
import { isBaileys, isOficial } from "../helpers/channelTraits";
import SendChannelMessage from "../services/ChannelServices/SendChannelMessage";
import { dentroDaJanela } from "../services/CloudApiServices/CloudApiSendService";
import { enviarModeloNaConversa } from "../services/CloudApiServices/CloudApiTemplateService";
import { parametrosDoContato } from "../services/CloudApiServices/CloudApiBroadcastService";
import formatBody from "../helpers/Mustache";
import { checkOpenHours } from "../helpers/checkOpenHours";
import { logger } from "../utils/logger";
import {
  ligarValNaConversa,
  registrarEnvioDeCampanha
} from "../services/SalesAiServices/SalesAiService";
import { notificarValoraPorEmail } from "../services/TagServices/notificarValora";
import {
  BotDoFunil,
  botDaAcao,
  decidirAgendamento,
  decidirExecucao,
  escolherResponsavel,
  respeitaExpedienteSeConfigurado
} from "../services/TagServices/funnelActionRules";
import { websocketUpdateTicket } from "../services/TicketServices/UpdateTicketService";

/**
 * Alguém da equipe atendeu depois do agendamento? Mensagem nossa que não é da
 * IA nem de automação (`sentBy` humano, ou vazio quando sai do celular), ou a
 * conversa foi finalizada.
 */
async function equipeAtendeuDesde(ticket: Ticket, desde: Date): Promise<boolean> {
  if (ticket.status === "closed") return true;
  const humana = await Message.findOne({
    where: {
      ticketId: ticket.id,
      fromMe: true,
      createdAt: { [Op.gt]: desde },
      [Op.or]: [{ sentBy: null }, { sentBy: "humano" }]
    } as any,
    attributes: ["id"]
  });
  return !!humana;
}

/** Dono da conta no CRM: o usuário cujo `externalId` é o tenant (user.id do dono na Valora). */
async function donoDaEmpresa(companyId: number): Promise<User | null> {
  const empresa = await Company.findByPk(companyId);
  if (!empresa?.externalId) return null;
  return User.findOne({ where: { companyId, externalId: empresa.externalId } });
}

/** Motivo que a IA deixou na nota ao passar a conversa (ver `passarParaHumano`). */
async function motivoDaPassagem(ticketId: number): Promise<string | null> {
  const nota = await TicketNote.findOne({
    where: { ticketId, note: { [Op.like]: "%A IA passou a conversa%" } } as any,
    order: [["createdAt", "DESC"]]
  });
  if (!nota) return null;
  const m = nota.note.match(/:\s*(.+)$/s);
  return (m ? m[1] : nota.note).trim().slice(0, 300) || null;
}

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

/**
 * Trava contra ciclo de "Mover para a lista" (A move para B, B move para A):
 * acima disto no último minuto, a automação para e registra o motivo.
 */
const MAX_MOVIMENTOS_POR_MINUTO = 3;

async function movimentosRecentes(ticketId: number): Promise<number> {
  const desde = new Date(Date.now() - 60 * 1000);
  return TagAutomationRun.count({
    where: { ticketId, createdAt: { [Op.gt]: desde } } as any,
    include: [{ model: FunnelAction, as: "action", where: { tipo: "mover" }, required: true }]
  });
}

/** Liga ou desliga o bot NESTA conversa. Estado interno: não fala com ninguém. */
async function aplicarBot(
  ticket: Ticket,
  ligado: boolean,
  bot: BotDoFunil
): Promise<void> {
  if (bot === "val_vendas") {
    const aplicou = await ligarValNaConversa(ticket, ligado, "funil");
    if (!aplicou) {
      logger.info(
        `[funnel] Val Vendas não se aplica ticket=${ticket.id}: número fora da Val Vendas`
      );
    }
    return;
  }
  await Ticket.update({ aiBotEnabled: ligado } as any, {
    where: { id: ticket.id }
  });
  logger.info(
    `[funnel] bot ${ligado ? "ligado" : "desligado"} ticket=${ticket.id}`
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
  companyId: number,
  /** Gatilho que não é lista nem Entrada: hoje só "ia_humano". */
  evento: string | null = null
): Promise<void> {
  try {
    // Conversa nova: só as automações do quadro da conversa. Conexão com
    // quadro próprio usa as dela; as demais usam as do Funil principal.
    // `evento` separa a Entrada (nulo) do "A IA passou para uma pessoa".
    let onde: Record<string, unknown> = { companyId, tagId, evento, ativo: true };
    if (tagId === null) {
      const ticket = await Ticket.findOne({
        where: { id: ticketId, companyId },
        attributes: ["id", "whatsappId"]
      });
      if (!ticket) return;
      const conexao = ticket.whatsappId
        ? await Whatsapp.findOne({
            where: { id: ticket.whatsappId, companyId },
            attributes: ["id", "ownBoard"]
          })
        : null;
      onde = { ...onde, whatsappId: conexao?.ownBoard ? conexao.id : null };
    }
    const acoes = await FunnelAction.findAll({
      where: onde as any,
      order: [["ordem", "ASC"]]
    });
    if (acoes.length === 0) return;

    for (const acao of acoes) {
      // `umaVezSo` é por AÇÃO, não por lista: uma lista pode mandar a mensagem
      // uma vez só e ligar o bot toda vez que o card voltar. Vale primeiro a
      // execução que saiu ou ainda está na fila (sem motivo de descarte); uma
      // falha mais recente não pode esconder um envio que já aconteceu.
      const ultimoDisparo =
        (await TagAutomationRun.findOne({
          where: { ticketId, actionId: acao.id, skippedReason: null } as any,
          order: [["createdAt", "DESC"]]
        })) ??
        (await TagAutomationRun.findOne({
          where: { ticketId, actionId: acao.id } as any,
          order: [["createdAt", "DESC"]]
        }));

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

  // Presa à empresa da execução: run e ticket nascem juntos aqui dentro, mas
  // a checagem é barata e fecha a porta se um dia alguém enfileirar de fora.
  const ticket = await Ticket.findOne({
    where: { id: run.ticketId, companyId: run.companyId },
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
  const soSemResposta = !!(acao.config as Record<string, unknown> | null)?.soSemResposta;
  const clienteRespondeu =
    !!ticket.lastInboundAt && !!run.createdAt && ticket.lastInboundAt > run.createdAt;
  const soSemAtendimento = !!(acao.config as Record<string, unknown> | null)?.soSemAtendimento;
  const equipeAtendeu =
    soSemAtendimento && run.createdAt ? await equipeAtendeuDesde(ticket, run.createdAt) : false;
  const decisao = decidirExecucao({
    tipo: acao.tipo,
    aindaNaLista,
    exigeLista,
    respeitaExpediente,
    soSemResposta,
    clienteRespondeu,
    soSemAtendimento,
    equipeAtendeu,
    // Só consulta o expediente quando a regra pede — evita ida ao banco à toa.
    dentroDoExpediente:
      respeitaExpediente && respeitaExpedienteSeConfigurado(acao.tipo)
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
    if (acao.tipo === "mover") {
      const destino = Number((acao.config as Record<string, unknown> | null)?.tagId) || 0;
      const motivo = !destino
        ? "ação de mover sem lista de destino"
        : destino === acao.tagId
        ? "a lista de destino é a própria lista do gatilho"
        : (await movimentosRecentes(ticket.id)) >= MAX_MOVIMENTOS_POR_MINUTO
        ? "possível ciclo: o card já foi movido por automação várias vezes no último minuto"
        : null;
      if (motivo) {
        await run.update({ skippedReason: motivo } as any);
        logger.warn(`[funnel] mover cancelado run=${runId}: ${motivo}`);
        return;
      }
      // Import tardio: AcoesDoBot → TicketTagServices → esta fila.
      const { moverParaLista } = await import("../services/AiBotServices/AcoesDoBot");
      const resultado = await moverParaLista(ticket, destino);
      await run.update({ sentAt: new Date() } as any);
      logger.info(`[funnel] mover ticket=${ticket.id} acao=${acao.id}: ${resultado}`);
      return;
    }

    if (acao.tipo === "atribuir") {
      const config = (acao.config || {}) as Record<string, unknown>;
      const ids = Array.isArray(config.userIds) ? (config.userIds as number[]) : [];
      // Só pessoas que ainda existem nesta empresa (alguém pode ter saído da equipe).
      const validos = ids.length
        ? (await User.findAll({ where: { id: ids.map(Number), companyId: run.companyId }, attributes: ["id"] })).map(u => u.id)
        : [];
      const ordem = ids.map(Number).filter(id => validos.includes(id));
      const escolhido =
        escolherResponsavel(ordem, config.modo as string, config.ultimo as number) ??
        (await donoDaEmpresa(run.companyId))?.id ??
        null;
      if (!escolhido) {
        await run.update({ skippedReason: "ninguém da equipe para atribuir" } as any);
        return;
      }
      await ticket.update({ userId: escolhido });
      websocketUpdateTicket(ticket);
      if (config.modo === "rodizio") await acao.update({ config: { ...config, ultimo: escolhido } } as any);
      await run.update({ sentAt: new Date() } as any);
      logger.info(`[funnel] atribuir ticket=${ticket.id} acao=${acao.id} user=${escolhido}`);
      return;
    }

    if (acao.tipo === "bot_ligar" || acao.tipo === "bot_desligar") {
      await aplicarBot(
        ticket,
        acao.tipo === "bot_ligar",
        botDaAcao(acao.config as any)
      );
      await run.update({ sentAt: new Date() } as any);
      return;
    }

    if (acao.tipo === "email") {
      // Quem envia é a Valora — ver `notificarValora.ts` para o porquê.
      const iaHumano = String(acao.evento || "").startsWith("ia_humano");
      // Aviso de lead esperando: no gatilho da IA ou quando a ação pede o modelo
      // (os passos do Elo Eventos moram na lista "Aguardando atendimento").
      const leadAguardando = iaHumano || acao.config?.modelo === "lead_aguardando";
      const lista = acao.tagId
        ? (await Tag.findByPk(acao.tagId))?.name ?? `lista ${acao.tagId}`
        : iaHumano
        ? "A IA passou para uma pessoa"
        : "conversa nova";
      // Destino: "responsavel" = quem está no card; "dono" ou vazio = a Valora
      // escolhe o dono da conta; qualquer outro texto é um e-mail digitado.
      const destino = String(acao.config?.para || "").trim();
      let para: string | null = destino && destino !== "responsavel" && destino !== "dono" ? destino : null;
      if (destino === "responsavel") {
        const atual = await Ticket.findByPk(ticket.id, { include: [{ model: User, as: "user" }] });
        para = atual?.user?.email || null;
      }

      // A Valora identifica o cliente pelo `externalId` da empresa, que é o
      // `user.id` do dono — não pelo id interno do CRM.
      const empresa = await Company.findByPk(run.companyId);
      if (!empresa?.externalId) {
        await run.update({
          skippedReason: "empresa sem vínculo com a Valora"
        } as any);
        return;
      }

      const enviado = await notificarValoraPorEmail({
        tenantId: empresa.externalId,
        para,
        ticketId: ticket.id,
        contatoNome: ticket.contact?.name ?? "",
        contatoNumero: ticket.contact?.number ?? "",
        gatilho: lista,
        observacao: (acao.config?.observacao as string) || null,
        ...(leadAguardando
          ? {
              modelo: "lead_aguardando",
              motivo: await motivoDaPassagem(ticket.id),
              esperandoMin: Math.max(0, acao.atrasoMinutos ?? 0),
              responsavelNome:
                (await Ticket.findByPk(ticket.id, { include: [{ model: User, as: "user" }] }))?.user?.name ?? null
            }
          : {})
      });

      await run.update(
        enviado
          ? ({ sentAt: new Date() } as any)
          : ({ skippedReason: "Valora não conseguiu enviar o e-mail" } as any)
      );
      return;
    }

    if (acao.tipo === "modelo") {
      // Modelo aprovado pelo WhatsApp Oficial: não depende da janela de 24h —
      // é o caminho para o primeiro contato com um lead importado.
      if (!isOficial(ticket.channel)) {
        await run.update({
          skippedReason: "modelo só existe em conversa do WhatsApp Oficial"
        } as any);
        return;
      }
      const config = (acao.config || {}) as Record<string, unknown>;
      await enviarModeloNaConversa(
        run.companyId,
        ticket.id,
        String(config.templateName || ""),
        String(config.language || ""),
        parametrosDoContato(
          Array.isArray(config.params) ? (config.params as string[]) : [],
          ticket.contact?.name || null
        )
      );
      await run.update({ sentAt: new Date() } as any);
      await marcarCampanha(acao, ticket);
      logger.info(
        `[funnel] modelo ${config.templateName} enviado ticket=${ticket.id} acao=${acao.id}`
      );
      return;
    }

    // mensagem
    const corpo = formatBody(String(acao.config?.mensagem ?? ""), ticket);

    // Canais sem sessão do Baileys saem pela conexão do próprio card — é o que
    // garante que a automação do quadro do WhatsApp Oficial nunca fale pelo
    // número de outro quadro.
    if (!isBaileys(ticket.channel)) {
      if (isOficial(ticket.channel) && !dentroDaJanela(ticket)) {
        await run.update({
          skippedReason:
            "fora da janela de 24h do WhatsApp Oficial: só sai modelo aprovado"
        } as any);
        return;
      }
      await SendChannelMessage({ body: corpo, ticket });
      await run.update({ sentAt: new Date() } as any);
      await marcarCampanha(acao, ticket);
      logger.info(
        `[funnel] enviado ticket=${ticket.id} acao=${acao.id} canal=${ticket.channel}`
      );
      return;
    }

    const whatsapp =
      (ticket.whatsappId
        ? await Whatsapp.findOne({
            where: { id: ticket.whatsappId, companyId: run.companyId }
          })
        : null) || (await GetDefaultWhatsApp(run.companyId));
    if (!whatsapp) {
      await run.update({
        skippedReason: "sem conexão de WhatsApp disponível"
      } as any);
      return;
    }

    await SendMessage(whatsapp, {
      number: ticket.contact.number,
      body: corpo,
      // Grava na conversa: o atendente precisa ver o que saiu sem ele digitar.
      saveOnTicket: ticket.id
    });
    await run.update({ sentAt: new Date() } as any);
      await marcarCampanha(acao, ticket);
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
/** Val Vendas: mensagem de campanha numa lista de prospecção do painel (ELO-WA). */
async function marcarCampanha(acao: FunnelAction, ticket: Ticket): Promise<void> {
  try {
    if (!acao.tagId || !ticket.contact?.number) return;
    const lista = await Tag.findByPk(acao.tagId);
    await registrarEnvioDeCampanha(ticket.companyId, ticket.contact.number, acao.tagId, lista?.name || `lista ${acao.tagId}`);
  } catch (err: any) {
    logger.warn(`[funnel] marcação de campanha falhou ticket=${ticket.id}: ${err?.message}`);
  }
}

export async function desligarBotAoSairDaLista(
  ticketId: number,
  tagId: number,
  companyId: number
): Promise<void> {
  try {
    const ligavamOBot = await FunnelAction.findAll({
      where: { companyId, tagId, tipo: "bot_ligar", ativo: true } as any
    });
    if (!ligavamOBot.length) return;
    const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
    if (!ticket) return;
    const bots = new Set(ligavamOBot.map(a => botDaAcao(a.config as any)));
    for (const bot of bots) {
      // eslint-disable-next-line no-await-in-loop
      await aplicarBot(ticket, false, bot);
    }
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
