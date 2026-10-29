import { randomUUID } from "crypto";
import { Op } from "sequelize";

import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import {
  aplicarResposta,
  avaliarMensagemRecebida,
  escopoDeVendas,
  promptDeVendas
} from "../SalesAiServices/SalesAiService";
import FindOrCreateTicketServiceMeta from "../TicketServices/FindOrCreateTicketServiceMeta";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { generateBotReply, BotTurn } from "../../helpers/aiBot";
import { provedoresDaEmpresa } from "../AiBotServices/AiBotProvidersService";
import { botDeveResponder } from "../TagServices/funnelActionRules";
import { ListAiBotFileTextsService } from "../AiBotFileServices/AiBotFileService";
import { focoDoBot } from "../AiBotServices/FocoDoBotService";
import { passarParaHumano } from "../AiBotServices/PassarParaHumano";
import { contextoDeAcoes, executarAcoesDoBot, limparMarcadores } from "../AiBotServices/AcoesDoBot";
import { ferramentasDoBot } from "../AiBotServices/FerramentasDoBot";
import {
  AVISO_ACIMA_DO_SIMPLES,
  extrairPedidoDeSimulacao,
  prepararSimulacao
} from "../AiBotServices/SimulacaoNoBot";
import { logger } from "../../utils/logger";

/**
 * Webchat (Chat Widget do Site) — canal HTTP público.
 *
 * O visitante de um site externo conversa por um widget embutido. Cada empresa
 * (Company) tem uma "widget key" pública que mapeia para o seu companyId. As
 * conversas entram como tickets nativos (channel="webchat") no Inbox, e o bot
 * de IA configurado em crm/settings/ai-bot responde automaticamente (reusa
 * generateBotReply). Sem autenticação — a empresa é resolvida pela key.
 */

const CHANNEL = "webchat";
const HISTORY_LIMIT = 12;

export interface WidgetConfig {
  enabled: boolean;
  position: string; // "bottom-right" | "bottom-left"
  color: string;
  title: string;
  welcome: string;
}

/** Resolve o companyId a partir da widget key pública. `null` se inválida. */
export async function resolveCompanyByKey(widgetKey: string): Promise<number | null> {
  if (!widgetKey || !widgetKey.trim()) return null;
  const setting = await Setting.findOne({
    where: { key: "webchatWidgetKey", value: widgetKey.trim() }
  });
  return setting ? setting.companyId : null;
}

/**
 * F4 — allowlist de domínio: valida a origem (site de terceiro) contra a lista
 * `webchatAllowedDomains` da empresa (CSV). Vazia = permite qualquer origem
 * (compat com widgets já publicados). Ativa = só as origens listadas — evita
 * que copiem a widget-key pública e abusem/consumam a chave Anthropic da Valora.
 */
export async function isOriginAllowed(companyId: number, origin?: string): Promise<boolean> {
  const raw = await GetCompanySetting(companyId, "webchatAllowedDomains", "");
  // Normaliza cada entrada pra host puro: aceita "https://site.com/", "site.com/x"
  // ou "site.com" — usuarios colam URL completa e a comparacao e por host.
  const list = (raw || "")
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
    .map(d => {
      try {
        return new URL(d.includes("://") ? d : `https://${d}`).host;
      } catch {
        return d.replace(/\/.*$/, "");
      }
    })
    .filter(Boolean);
  if (list.length === 0) return true;
  if (!origin) return false;
  let host = "";
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    host = origin.toLowerCase();
  }
  host = host.replace(/^www\./, "");
  return list.some(d => {
    const dom = d.replace(/^www\./, "");
    return host === dom || host.endsWith("." + dom);
  });
}

/** Lê a configuração pública do widget para a empresa. */
export async function getWidgetConfig(companyId: number): Promise<WidgetConfig> {
  const enabled = (await GetCompanySetting(companyId, "webchatEnabled", "disabled")) === "enabled";
  const position = await GetCompanySetting(companyId, "webchatPosition", "bottom-right");
  const color = await GetCompanySetting(companyId, "webchatColor", "#22c55e");
  const title = await GetCompanySetting(companyId, "webchatTitle", "Atendimento");
  const welcome = await GetCompanySetting(
    companyId,
    "webchatWelcome",
    "Olá! 👋 Como podemos ajudar?"
  );
  return { enabled, position, color, title, welcome };
}

/**
 * Garante que exista uma "conexão" webchat (linha Whatsapp com channel=webchat)
 * para a empresa; devolve o id para associar aos tickets. Criada sob demanda.
 */
async function ensureConnection(companyId: number): Promise<number> {
  const existing = await Whatsapp.findOne({ where: { companyId, channel: CHANNEL } });
  if (existing) return existing.id;
  const created = await Whatsapp.create({
    name: "Chat do Site",
    companyId,
    channel: CHANNEL,
    status: "CONNECTED",
    isDefault: false
  } as any);
  return created.id;
}

/**
 * Teste do bot (pedido do Hélio, 28/10/2026): o dono conversa com o próprio bot
 * pelo painel antes de ligá-lo no WhatsApp. É o mesmo caminho do Chat do Site —
 * card na Entrada, foco por lista, ações, agenda, proposta, passagem para humano —
 * mas o contato é marcado "Teste do bot" e a conversa liga o bot só nela.
 */
export interface OpcoesDoChat {
  teste?: boolean;
}

/** Número interno único do contato-visitante a partir do token de sessão. */
function sessionNumber(sessionId: string, opts: OpcoesDoChat = {}): string {
  return `${opts.teste ? "teste-do-bot" : "webchat"}:${sessionId}`;
}

/** Cria uma nova sessão (token opaco). Contato/ticket são criados na 1ª mensagem. */
export function createSession(): string {
  return randomUUID();
}

async function findOrCreateContactAndTicket(companyId: number, sessionId: string, opts: OpcoesDoChat = {}) {
  const number = sessionNumber(sessionId, opts);
  const connectionId = await ensureConnection(companyId);
  const contact = await CreateOrUpdateContactService({
    name: opts.teste ? "Teste do bot" : "Visitante do site",
    number,
    isGroup: false,
    companyId,
    channel: CHANNEL
  } as any);
  const ticket = await FindOrCreateTicketServiceMeta(contact, connectionId, 1, companyId, CHANNEL);
  return { contact, ticket };
}

async function buildHistory(ticketId: number): Promise<BotTurn[]> {
  const rows = await Message.findAll({
    where: { ticketId },
    order: [["createdAt", "DESC"]],
    limit: HISTORY_LIMIT
  });
  // do mais antigo ao mais recente, ignorando itens vazios/sistema
  return rows
    .reverse()
    .filter(m => m.body && m.body.trim())
    .map(m => ({ role: m.fromMe ? "assistant" : "user", text: m.body } as BotTurn));
}

export interface WebchatMessageDTO {
  id: string;
  body: string;
  fromMe: boolean;
  createdAt: string;
}

function toDTO(m: Message): WebchatMessageDTO {
  return {
    id: m.id,
    body: m.body,
    fromMe: m.fromMe,
    createdAt: (m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt)).toISOString()
  };
}

/**
 * Registra a mensagem do visitante e, se o bot estiver ligado, gera e registra
 * a resposta. Devolve as mensagens novas (visitante + eventual resposta do bot).
 */
export async function handleVisitorMessage(
  companyId: number,
  sessionId: string,
  text: string,
  opts: OpcoesDoChat = {}
): Promise<{ messages: WebchatMessageDTO[] }> {
  const body = (text || "").trim();
  if (!body) return { messages: [] };

  const { contact, ticket } = await findOrCreateContactAndTicket(companyId, sessionId, opts);
  // Teste: o bot responde nesta conversa mesmo desligado na empresa (que é
  // justamente o caso — ainda não foi ligado no WhatsApp). Desligar no card vale.
  if (opts.teste && ticket.aiBotEnabled == null) await ticket.update({ aiBotEnabled: true });

  // histórico ANTES de gravar a mensagem atual (para o bot)
  const history = await buildHistory(ticket.id);

  const visitorMsg = await CreateMessageService({
    messageData: {
      id: randomUUID(),
      ticketId: ticket.id,
      contactId: contact.id,
      body,
      fromMe: false,
      read: true,
      channel: CHANNEL
    },
    companyId
  });

  const out: WebchatMessageDTO[] = [toDTO(visitorMsg)];

  // Val Vendas: se o chat do site estiver na configuração, quem decide é a regra nova.
  const decisaoDeVendas = opts.teste
    ? null
    : await avaliarMensagemRecebida(ticket, contact, { messageId: visitorMsg.id });
  if (decisaoDeVendas) {
    if (decisaoDeVendas.reply) {
      try {
        const cfg = await escopoDeVendas(ticket);
        const reply = cfg
          ? await generateBotReply({
              persona: await promptDeVendas(cfg),
              knowledge: "",
              history,
              userMessage: body,
              files: [],
              provedores: await provedoresDaEmpresa(companyId)
            })
          : null;
        const corpo = reply && cfg
          ? await aplicarResposta(ticket, contact, cfg, reply.text, { handoff: reply.kind === "handoff", falha: !!reply.falha })
          : "";
        if (corpo) {
          const botMsg = await CreateMessageService({
            messageData: { id: randomUUID(), ticketId: ticket.id, contactId: contact.id, body: corpo, fromMe: true, read: true, channel: CHANNEL, sentBy: "ai" },
            companyId
          });
          out.push(toDTO(botMsg));
        }
      } catch (err) {
        logger.error({ err }, "[val-vendas] chat do site: falha ao responder");
      }
    }
    return { messages: out };
  }

  // Bot só responde se: ligado + chave central presente + ticket sem atendente humano.
  // A decisão DESTA conversa vence a da empresa, igual ao WhatsApp: o botão do
  // card tem de valer no widget também, senão desligar o bot num atendimento
  // silencia um canal e deixa o outro respondendo por cima do humano.
  const daEmpresa =
    (await GetCompanySetting(companyId, "aiBotEnabled", "disabled")) === "enabled";
  // Teste do bot: a chave geral está desligada justamente porque o bot ainda não
  // foi ligado no WhatsApp — aqui só vale o botão desta conversa.
  const botEnabled = opts.teste
    ? ticket.aiBotEnabled !== false
    : botDeveResponder(ticket.aiBotEnabled, daEmpresa);
  const provedores = botEnabled ? await provedoresDaEmpresa(companyId) : [];
  if (botEnabled && provedores.length && !ticket.userId) {
    try {
      const persona = await GetCompanySetting(companyId, "aiBotPersona", "");
      const knowledge = await GetCompanySetting(companyId, "aiBotKnowledge", "");
      const files = await ListAiBotFileTextsService(companyId);
      const foco = await focoDoBot(ticket.id, companyId);
      const reply = await generateBotReply({
        persona,
        knowledge,
        history,
        userMessage: body,
        contactName: undefined,
        files,
        foco,
        acoes: await contextoDeAcoes(ticket.id, companyId),
        provedores,
        ferramentas: await ferramentasDoBot(ticket.id, companyId)
      });
      // No Chat do Site a simulação sai como texto (o widget não mostra imagem).
      const semAcoes = reply
        ? await executarAcoesDoBot(ticket.id, companyId, reply.text.trim())
        : "";
      const { texto: comMarcadores, pedido } = semAcoes
        ? extrairPedidoDeSimulacao(semAcoes)
        : { texto: "", pedido: null };
      const textoDoBot = limparMarcadores(comMarcadores);
      let corpo = textoDoBot;
      if (pedido) {
        const pronta = await prepararSimulacao(companyId, ticket.id, pedido);
        corpo = [textoDoBot, pronta ? pronta.legenda : AVISO_ACIMA_DO_SIMPLES]
          .filter(Boolean)
          .join("\n\n");
      }
      if (corpo) {
        const botMsg = await CreateMessageService({
          messageData: {
            id: randomUUID(),
            ticketId: ticket.id,
            contactId: contact.id,
            body: corpo,
            fromMe: true,
            read: true,
            channel: CHANNEL,
            sentBy: "ai"
          },
          companyId
        });
        out.push(toDTO(botMsg));
      }
      if (reply?.kind === "handoff") {
        await passarParaHumano(ticket.id, companyId, { motivo: reply.motivo, falha: reply.falha });
      }
    } catch (err) {
      logger.error({ err }, "webchat: falha ao gerar resposta do bot");
    }
  }

  return { messages: out };
}

/**
 * Poll: mensagens do lado do atendente/bot (fromMe) posteriores ao cursor —
 * para o widget mostrar respostas humanas depois do handoff.
 */
export async function pollMessages(
  companyId: number,
  sessionId: string,
  afterIso?: string,
  opts: OpcoesDoChat = {}
): Promise<{ messages: WebchatMessageDTO[] }> {
  const contact = await Contact.findOne({
    where: { companyId, number: sessionNumber(sessionId, opts) }
  });
  if (!contact) return { messages: [] };

  const where: any = { companyId, contactId: contact.id, fromMe: true };
  if (afterIso) {
    const after = new Date(afterIso);
    if (!Number.isNaN(after.getTime())) where.createdAt = { [Op.gt]: after };
  }
  const rows = await Message.findAll({
    where,
    order: [["createdAt", "ASC"]],
    limit: 30
  });
  return { messages: rows.filter(m => m.body && m.body.trim()).map(toDTO) };
}
