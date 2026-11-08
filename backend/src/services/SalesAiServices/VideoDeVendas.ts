import GetTicketWbot from "../../helpers/GetTicketWbot";
import { isOficial } from "../../helpers/channelTraits";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import { CHANNEL as CANAL_OFICIAL } from "../CloudApiServices/CloudApiChannel";
import { sendVideo } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { SalesAiConfig } from "../../models/SalesAi";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { getJidOf } from "../WbotServices/getJidOf";
import { verifyMediaMessage } from "../WbotServices/wbotMessageListener";
import { registrarEnvio } from "./SalesAiService";
import { produtoDaConversa, videoDoProduto } from "./salesAiRules";

const NOME_DO_ARQUIVO = "demonstracao.mp4";

/**
 * Envia o vídeo de demonstração do produto, quando a IA pede com `[[VIDEO]]`.
 * Sai pelo canal do card: QR (Baileys) ou WhatsApp Oficial (por link). Uma vez
 * só por conversa: quem já recebeu não recebe de novo.
 *
 * Falha aqui nunca derruba a conversa: o texto já saiu, e o lead segue atendido
 * sem o vídeo.
 */
export async function enviarVideoDeVendas(
  ticket: Ticket,
  cfg: SalesAiConfig,
  contato?: Contact
): Promise<boolean> {
  const video = videoDoProduto(cfg.produtos, produtoDaConversa(ticket.salesSource));
  if (!video) {
    logger.info(`[val-vendas] ticket ${ticket.id}: a IA pediu vídeo, mas o produto não tem vídeo no painel`);
    return false;
  }
  try {
    const jaRecebeu = await Message.count({
      where: { ticketId: ticket.id, fromMe: true, mediaType: "video", sentBy: "ai" } as any
    });
    if (jaRecebeu) return false;

    if (isOficial(ticket.channel)) {
      const pessoa = contato || ticket.contact || (await Contact.findByPk(ticket.contactId));
      const whatsapp = ticket.whatsappId ? await Whatsapp.findByPk(ticket.whatsappId) : null;
      if (!whatsapp || !pessoa?.number) {
        logger.warn(`[val-vendas] ticket ${ticket.id}: sem conexão ou número para o vídeo no Oficial`);
        return false;
      }
      const legenda = video.legenda || "";
      const { wamid } = await sendVideo(whatsapp, pessoa.number, video.url, legenda);
      await CreateMessageService({
        messageData: {
          id: wamid,
          ticketId: ticket.id,
          contactId: pessoa.id,
          body: legenda,
          fromMe: true,
          read: true,
          ack: 1,
          channel: CANAL_OFICIAL,
          sentBy: "ai",
          mediaType: "video",
          mediaUrl: video.url
        },
        companyId: ticket.companyId
      });
      logger.info(`[val-vendas] ticket ${ticket.id}: vídeo de demonstração enviado pelo Oficial`);
      return true;
    }

    const wbot = await GetTicketWbot(ticket);
    const enviada = await wbot.sendMessage(getJidOf(ticket), {
      video: { url: video.url },
      caption: video.legenda || undefined,
      mimetype: "video/mp4",
      fileName: NOME_DO_ARQUIVO
    });
    registrarEnvio(enviada?.key?.id, "ai");
    await verifyMediaMessage(enviada, ticket, ticket.contact, {
      mediaInfo: { mediaUrl: video.url, mimetype: "video/mp4", filename: NOME_DO_ARQUIVO }
    });
    logger.info(`[val-vendas] ticket ${ticket.id}: vídeo de demonstração enviado`);
    return true;
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: ticket.id }, "[val-vendas] vídeo de demonstração falhou");
    return false;
  }
}
