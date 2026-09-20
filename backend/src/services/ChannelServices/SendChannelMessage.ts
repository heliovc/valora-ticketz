import { randomUUID } from "crypto";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ShowContactService from "../ContactServices/ShowContactService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { CANAL_WEBCHAT, isBaileys, isOficial } from "../../helpers/channelTraits";
import { getCompanyConnection } from "../CloudApiServices/CloudApiChannel";
import {
  dentroDaJanela,
  sendText
} from "../CloudApiServices/CloudApiSendService";

/**
 * Envia a resposta do atendente pelo canal da conversa.
 *
 * Substitui a cadeia de `if` que vivia dentro do `MessageController`. O ganho
 * não é estético: naquela cadeia, uma conversa de canal desconhecido caía fora
 * de todos os ramos e a rota respondia 200 **sem enviar nada** — o atendente
 * digitava, via a mensagem sumir e achava que tinha enviado. Aqui, canal sem
 * tratamento é erro explícito.
 *
 * Não devolve nada de propósito: cada canal já grava a própria `Message` por
 * dentro (o Baileys faz isso dentro de `SendWhatsAppMessage`), e devolver um
 * tipo do Baileys aqui obrigaria o canal oficial a forjar um objeto de uma
 * biblioteca que ele não usa.
 */
export interface EnvioParams {
  body: string;
  ticket: Ticket;
  userId?: number | null;
  quotedMsg?: Message;
}

export default async function SendChannelMessage({
  body,
  ticket,
  userId,
  quotedMsg
}: EnvioParams): Promise<void> {
  if (isBaileys(ticket.channel)) {
    // `SendWhatsAppMessage` já persiste a mensagem (chama `verifyMessage` por
    // dentro) — não repetir aqui, senão a mensagem aparece duas vezes.
    await SendWhatsAppMessage({ body, ticket, userId, quotedMsg });
    return;
  }

  if (isOficial(ticket.channel)) {
    await enviarPeloOficial({ body, ticket });
    return;
  }

  if (ticket.channel === CANAL_WEBCHAT) {
    // Chat do Site: não há para onde enviar — o widget do visitante busca a
    // resposta por conta própria. Persistir É o envio.
    await CreateMessageService({
      messageData: {
        id: randomUUID(),
        ticketId: ticket.id,
        contactId: ticket.contactId,
        body,
        fromMe: true,
        read: true,
        channel: CANAL_WEBCHAT
      },
      companyId: ticket.companyId
    });
    return;
  }

  throw new AppError(
    `Esta conversa é de um canal sem envio configurado (${ticket.channel}). A mensagem não foi enviada.`,
    400
  );
}

async function enviarPeloOficial({
  body,
  ticket
}: Pick<EnvioParams, "body" | "ticket">): Promise<Message> {
  const conexao = await getCompanyConnection(ticket.companyId);
  if (!conexao) {
    throw new AppError(
      "O WhatsApp Oficial não está configurado nesta conta. Configure em CRM → Canais.",
      400
    );
  }

  // A regra é da Meta, não nossa: passadas 24h desde a última mensagem do
  // cliente, só sai modelo aprovado. Avisar ANTES de tentar poupa o atendente
  // de um erro em inglês vindo da Graph API.
  if (!dentroDaJanela(ticket)) {
    throw new AppError(
      "Passaram mais de 24 horas desde a última mensagem do cliente. O WhatsApp só permite responder com um modelo aprovado — peça para o cliente escrever, ou envie uma cobrança.",
      400
    );
  }

  const contact = ticket.contact
    ? ticket.contact
    : await ShowContactService(ticket.contactId, ticket.companyId);

  const { wamid } = await sendText(conexao, contact.number, body);

  return CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body,
      fromMe: true,
      read: true,
      ack: 1,
      channel: ticket.channel
    },
    companyId: ticket.companyId
  });
}
