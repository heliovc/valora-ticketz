import * as Sentry from "@sentry/node";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import { hmacSha256Hex, safeEqualBuffers } from "../../helpers/cloudApiCrypto";
import { generateBotReply, isAiBotAvailable, BotTurn } from "../../helpers/aiBot";
import { botDeveResponder } from "../TagServices/funnelActionRules";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketServiceMeta from "../TicketServices/FindOrCreateTicketServiceMeta";
import CreateMessageService from "../MessageServices/CreateMessageService";
import {
  CHANNEL,
  numberWhereClause,
  resolveConnectionByPhoneNumberId
} from "./CloudApiChannel";
import { sendText } from "./CloudApiSendService";

/**
 * Recebimento do WhatsApp Oficial (Meta Cloud API).
 *
 * A Meta entrega tudo por um webhook só — um App tem UMA URL para todas as
 * contas inscritas nele. Por isso o roteamento é sempre por
 * `value.metadata.phone_number_id`, e nunca por variável de ambiente: é o que
 * faz este mesmo código atender um número (hoje) ou mil (quando cada lojista
 * conectar o dele).
 */

const HISTORY_LIMIT = 12;

/**
 * Confere a assinatura `X-Hub-Signature-256`.
 *
 * Sem isto, qualquer um que descubra a URL injeta mensagem falsa em qualquer
 * conversa de qualquer empresa. O webhook que o Ticketz original tinha (e
 * deletou em 2025) NÃO validava assinatura — é o erro a não repetir.
 *
 * Se `META_APP_SECRET` não estiver configurado, recusa tudo. Degradar para
 * "aceita sem assinatura" seria transformar uma falha de configuração num
 * buraco aberto.
 */
export function assinaturaValida(
  rawBody: Buffer | undefined,
  header: string | undefined
): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    logger.error(
      "CloudApi: META_APP_SECRET não configurado — webhook recusado por segurança"
    );
    return false;
  }
  if (!rawBody || !header) return false;

  const esperado = `sha256=${hmacSha256Hex(secret, rawBody)}`;
  return safeEqualBuffers(
    Buffer.from(esperado, "utf8"),
    Buffer.from(header, "utf8")
  );
}

/** Extrai texto legível de qualquer tipo de mensagem que a Meta entregue. */
function extrairTexto(msg: any): { body: string; mediaType?: string } {
  switch (msg?.type) {
    case "text":
      return { body: msg.text?.body || "" };
    case "button":
      return { body: msg.button?.text || "" };
    case "interactive":
      return {
        body:
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          ""
      };
    case "location": {
      const l = msg.location || {};
      const nome = l.name || l.address || "";
      return {
        body: `📍 Localização${nome ? `: ${nome}` : ""} (${l.latitude}, ${l.longitude})`
      };
    }
    case "contacts":
      return { body: "👤 Contato recebido" };
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      // Baixar a mídia é um passo a mais (URL assinada da Graph) e fica para a
      // próxima entrega. Aqui o atendente pelo menos SABE que algo chegou, em
      // vez de ver a conversa pular sem explicação.
      return {
        body:
          msg[msg.type]?.caption ||
          `📎 ${msg.type === "image" ? "Imagem" : msg.type === "audio" ? "Áudio" : msg.type === "video" ? "Vídeo" : msg.type === "sticker" ? "Figurinha" : "Documento"} recebido — abra no celular para ver`,
        mediaType: msg.type
      };
    case "unsupported":
      return { body: "Mensagem de um tipo que o WhatsApp não repassa." };
    default:
      return { body: "" };
  }
}

/** Histórico recente para o bot, do mais antigo ao mais novo. */
async function montarHistorico(ticketId: number): Promise<BotTurn[]> {
  const rows = await Message.findAll({
    where: { ticketId },
    order: [["createdAt", "DESC"]],
    limit: HISTORY_LIMIT
  });
  return rows
    .reverse()
    .filter(m => m.body && m.body.trim())
    .map(m => ({ role: m.fromMe ? "assistant" : "user", text: m.body } as BotTurn));
}

/**
 * Acha ou cria o contato, tolerando o nono dígito.
 *
 * A Meta manda o número do Brasil muitas vezes SEM o 9; o Baileys grava COM.
 * Como `Contact.number` é único, procurar só a forma exata criaria um segundo
 * contato para a mesma pessoa — ou estouraria a constraint dentro do webhook.
 */
async function acharOuCriarContato(
  companyId: number,
  numeroDaMeta: string,
  nomePerfil: string
): Promise<Contact> {
  const existente = await Contact.findOne({
    where: { companyId, ...numberWhereClause(numeroDaMeta) } as any
  });

  return CreateOrUpdateContactService({
    // Reusa o número já gravado, para não duplicar o contato.
    number: existente ? existente.number : numeroDaMeta.replace(/\D/g, ""),
    name: nomePerfil || existente?.name || numeroDaMeta,
    isGroup: false,
    companyId,
    channel: CHANNEL
  } as any);
}

/** Uma mensagem recebida. */
async function processarMensagem(
  whatsapp: Whatsapp,
  value: any,
  msg: any
): Promise<void> {
  const wamid: string = msg?.id;
  if (!wamid) return;

  // Idempotência: a Meta reentrega o mesmo evento quando desconfia que não
  // chegou (e reentrega mesmo). `Message.id` é a chave primária e é string,
  // então o próprio wamid resolve — mas `upsert` reemitiria o websocket e a
  // mensagem piscaria de novo na tela. Daí o corte antes.
  const jaExiste = await Message.findByPk(wamid);
  if (jaExiste) {
    logger.debug({ wamid }, "CloudApi: evento repetido, ignorado");
    return;
  }

  const { companyId } = whatsapp;
  const { body, mediaType } = extrairTexto(msg);
  if (!body) return;

  const nomePerfil = value?.contacts?.[0]?.profile?.name || "";
  const contact = await acharOuCriarContato(companyId, msg.from, nomePerfil);

  const ticket = await FindOrCreateTicketServiceMeta(
    contact,
    whatsapp.id,
    1,
    companyId,
    CHANNEL
  );

  // Histórico ANTES de gravar a mensagem atual (o bot recebe a atual à parte).
  const historico = await montarHistorico(ticket.id);

  await CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: contact.id,
      body,
      fromMe: false,
      read: false,
      ...(mediaType ? { mediaType } : {}),
      channel: CHANNEL
    },
    companyId
  });

  // Abre (ou renova) a janela de 24h. Sem esta marca não há como saber, na hora
  // de responder, se a Meta vai aceitar texto livre.
  await ticket.update({ lastInboundAt: new Date() });

  await responderComBot(whatsapp, ticket, contact, body, historico);
}

/**
 * Resposta automática do bot de IA — mesmo comportamento do Chat do Site.
 *
 * O canal oficial NÃO tem, nesta entrega, a máquina de saudação/fila/opções do
 * Baileys: ela vive dentro do listener do Baileys e replicá-la é outro projeto.
 * Aqui é bot de IA ou atendimento humano, como no webchat.
 */
async function responderComBot(
  whatsapp: Whatsapp,
  ticket: Ticket,
  contact: Contact,
  mensagem: string,
  historico: BotTurn[]
): Promise<void> {
  const { companyId } = whatsapp;
  const daEmpresa =
    (await GetCompanySetting(companyId, "aiBotEnabled", "disabled")) === "enabled";

  if (!botDeveResponder(ticket.aiBotEnabled, daEmpresa)) return;
  if (!isAiBotAvailable()) return;
  // Humano assumiu a conversa: o bot sai de cena.
  if (ticket.userId) return;

  try {
    const persona = await GetCompanySetting(companyId, "aiBotPersona", "");
    const knowledge = await GetCompanySetting(companyId, "aiBotKnowledge", "");
    const resposta = await generateBotReply({
      persona,
      knowledge,
      history: historico,
      userMessage: mensagem,
      contactName: contact.name
    });

    if (!resposta || !resposta.text.trim()) return;

    const texto = resposta.text.trim();
    const { wamid } = await sendText(whatsapp, contact.number, texto);
    await CreateMessageService({
      messageData: {
        id: wamid,
        ticketId: ticket.id,
        contactId: contact.id,
        body: texto,
        fromMe: true,
        read: true,
        ack: 1,
        channel: CHANNEL
      },
      companyId
    });
  } catch (err: any) {
    // Bot que falha deixa a conversa para o humano — nunca derruba o webhook.
    Sentry.captureException(err);
    logger.error(
      { ticketId: ticket.id, message: err?.message },
      "CloudApi: bot de IA não respondeu"
    );
  }
}

/**
 * Confirmações de entrega/leitura.
 *
 * Mesma regra do Baileys (`handleMsgAck`): status chegam fora de ordem com
 * frequência, então um ack menor nunca sobrescreve um maior. A função original
 * não é exportada e vive num arquivo de 2200 linhas acoplado ao Baileys —
 * replicar as poucas linhas custa menos que mexer lá.
 */
async function processarStatus(whatsapp: Whatsapp, status: any): Promise<void> {
  const mapa: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
  const ack = mapa[status?.status];

  if (status?.status === "failed") {
    logger.warn(
      {
        wamid: status?.id,
        erros: status?.errors,
        phoneNumberId: whatsapp.cloudApiPhoneNumberId
      },
      "CloudApi: a Meta recusou a entrega desta mensagem"
    );
    return;
  }
  if (!ack || !status?.id) return;

  const message = await Message.findByPk(status.id);
  if (!message || ack <= message.ack) return;

  await message.update({ ack });
  getIO()
    .to(message.ticketId.toString())
    .emit(`company-${message.companyId}-appMessage`, {
      action: "update",
      message
    });
}

/**
 * Ponto de entrada do webhook.
 *
 * NUNCA lança: o controller já respondeu 200 à Meta antes de chamar isto. Erro
 * aqui é log, não repetição — devolver não-200 faria a Meta reenviar tudo em
 * backoff e multiplicar o trabalho.
 */
export async function processarEvento(payload: any): Promise<void> {
  try {
    if (payload?.object !== "whatsapp_business_account") {
      logger.debug({ object: payload?.object }, "CloudApi: evento ignorado");
      return;
    }

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") {
          // `message_template_status_update` e `phone_number_quality_update`
          // passam por aqui. Ainda não tratados — mas registrados, porque é
          // por eles que se descobre template reprovado e qualidade caindo.
          logger.info(
            { field: change.field, value: change.value },
            "CloudApi: evento não tratado nesta versão"
          );
          continue;
        }

        const value = change.value || {};
        const phoneNumberId = value?.metadata?.phone_number_id;
        const whatsapp = await resolveConnectionByPhoneNumberId(phoneNumberId);

        if (!whatsapp) {
          logger.warn(
            { phoneNumberId },
            "CloudApi: chegou mensagem de um número que não está configurado aqui"
          );
          continue;
        }

        for (const msg of value.messages || []) {
          await processarMensagem(whatsapp, value, msg);
        }
        for (const status of value.statuses || []) {
          await processarStatus(whatsapp, status);
        }
      }
    }
  } catch (err: any) {
    Sentry.captureException(err);
    logger.error(
      { message: err?.message, stack: err?.stack },
      "CloudApi: falha ao processar evento do webhook"
    );
  }
}
