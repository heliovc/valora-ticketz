import GetTicketWbot from "../../helpers/GetTicketWbot";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { CHANNEL as CANAL_OFICIAL } from "../CloudApiServices/CloudApiChannel";
import { sendImageLink, sendText, sendVideo } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { registrarEnvio } from "../SalesAiServices/SalesAiService";
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";
import { getJidOf } from "../WbotServices/getJidOf";
import { verifyMediaMessage } from "../WbotServices/wbotMessageListener";
import { linhaDeLink, MidiaDoBot } from "./MidiasDoBot";

/**
 * Envio das fotos e vídeos que o bot pediu com [[ENVIAR_MIDIA]], depois do
 * texto. Cada arquivo que falhar (Meta recusou, link fora do ar) vira a
 * legenda com o link: o cliente nunca fica sem nada, e a conversa não cai.
 */

const nomeDoArquivo = (m: MidiaDoBot) => `${m.codigo.toLowerCase()}${m.tipo === "video" ? ".mp4" : m.mime === "image/png" ? ".png" : ".jpg"}`;

/** QR (Baileys): o celular baixa do link. Grava com o link, para saber o que já foi. */
export async function enviarMidiasPeloQr(ticket: Ticket, midias: MidiaDoBot[]): Promise<void> {
  if (!midias.length) return;
  const falharam: MidiaDoBot[] = [];
  const wbot = await GetTicketWbot(ticket);
  for (const m of midias) {
    try {
      const conteudo =
        m.tipo === "video"
          ? { video: { url: m.url }, caption: m.legenda || undefined, mimetype: "video/mp4", fileName: nomeDoArquivo(m) }
          : { image: { url: m.url }, caption: m.legenda || undefined };
      // eslint-disable-next-line no-await-in-loop
      const enviada = await wbot.sendMessage(getJidOf(ticket), conteudo as any);
      registrarEnvio(enviada?.key?.id, "ai");
      // eslint-disable-next-line no-await-in-loop
      await verifyMediaMessage(enviada, ticket, ticket.contact, {
        mediaInfo: { mediaUrl: m.url, mimetype: m.mime, filename: nomeDoArquivo(m) }
      });
    } catch (err: any) {
      logger.warn({ err: err?.message, ticketId: ticket.id, codigo: m.codigo }, "[aiBot] foto/vídeo não saiu pelo QR; vai o link");
      falharam.push(m);
    }
  }
  if (falharam.length) {
    await SendWhatsAppMessage({ body: falharam.map(linhaDeLink).join("\n"), ticket });
  }
  logger.info(`[aiBot] ticket ${ticket.id}: ${midias.length - falharam.length}/${midias.length} fotos/vídeos enviados pelo QR`);
}

/** WhatsApp Oficial: a Meta baixa do link público. */
export async function enviarMidiasPeloOficial(
  ticket: Ticket,
  whatsapp: Whatsapp,
  contato: Contact,
  midias: MidiaDoBot[]
): Promise<void> {
  if (!midias.length) return;
  const falharam: MidiaDoBot[] = [];
  for (const m of midias) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { wamid } =
        m.tipo === "video"
          ? await sendVideo(whatsapp, contato.number, m.url, m.legenda)
          : await sendImageLink(whatsapp, contato.number, m.url, m.legenda);
      // eslint-disable-next-line no-await-in-loop
      await CreateMessageService({
        messageData: {
          id: wamid,
          ticketId: ticket.id,
          contactId: contato.id,
          body: m.legenda,
          fromMe: true,
          read: true,
          ack: 1,
          channel: CANAL_OFICIAL,
          sentBy: "ai",
          mediaType: m.tipo === "video" ? "video" : "image",
          mediaUrl: m.url
        },
        companyId: ticket.companyId
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, detalhe: err?.response?.data, ticketId: ticket.id, codigo: m.codigo },
        "[aiBot] foto/vídeo não saiu pelo Oficial; vai o link"
      );
      falharam.push(m);
    }
  }
  if (falharam.length) {
    const corpo = falharam.map(linhaDeLink).join("\n");
    try {
      const { wamid } = await sendText(whatsapp, contato.number, corpo);
      await CreateMessageService({
        messageData: { id: wamid, ticketId: ticket.id, contactId: contato.id, body: corpo, fromMe: true, read: true, ack: 1, channel: CANAL_OFICIAL, sentBy: "ai" },
        companyId: ticket.companyId
      });
    } catch (err: any) {
      logger.error({ err: err?.message, ticketId: ticket.id }, "[aiBot] nem o link das fotos saiu pelo Oficial");
    }
  }
  logger.info(`[aiBot] ticket ${ticket.id}: ${midias.length - falharam.length}/${midias.length} fotos/vídeos enviados pelo Oficial`);
}
