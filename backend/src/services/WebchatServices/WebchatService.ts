import { randomUUID } from "crypto";
import { Op } from "sequelize";

import Setting from "../../models/Setting";
import Whatsapp from "../../models/Whatsapp";
import Message from "../../models/Message";
import Contact from "../../models/Contact";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketServiceMeta from "../TicketServices/FindOrCreateTicketServiceMeta";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { generateBotReply, isAiBotAvailable, BotTurn } from "../../helpers/aiBot";
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

/** Número interno único do contato-visitante a partir do token de sessão. */
function sessionNumber(sessionId: string): string {
  return `webchat:${sessionId}`;
}

/** Cria uma nova sessão (token opaco). Contato/ticket são criados na 1ª mensagem. */
export function createSession(): string {
  return randomUUID();
}

async function findOrCreateContactAndTicket(companyId: number, sessionId: string) {
  const number = sessionNumber(sessionId);
  const connectionId = await ensureConnection(companyId);
  const contact = await CreateOrUpdateContactService({
    name: "Visitante do site",
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
  text: string
): Promise<{ messages: WebchatMessageDTO[] }> {
  const body = (text || "").trim();
  if (!body) return { messages: [] };

  const { contact, ticket } = await findOrCreateContactAndTicket(companyId, sessionId);

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

  // Bot só responde se: ligado + chave central presente + ticket sem atendente humano.
  const botEnabled = (await GetCompanySetting(companyId, "aiBotEnabled", "disabled")) === "enabled";
  if (botEnabled && isAiBotAvailable() && !ticket.userId) {
    try {
      const persona = await GetCompanySetting(companyId, "aiBotPersona", "");
      const knowledge = await GetCompanySetting(companyId, "aiBotKnowledge", "");
      const reply = await generateBotReply({
        persona,
        knowledge,
        history,
        userMessage: body,
        contactName: undefined
      });
      if (reply && reply.trim()) {
        const botMsg = await CreateMessageService({
          messageData: {
            id: randomUUID(),
            ticketId: ticket.id,
            contactId: contact.id,
            body: reply.trim(),
            fromMe: true,
            read: true,
            channel: CHANNEL
          },
          companyId
        });
        out.push(toDTO(botMsg));
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
  afterIso?: string
): Promise<{ messages: WebchatMessageDTO[] }> {
  const contact = await Contact.findOne({
    where: { companyId, number: sessionNumber(sessionId) }
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
