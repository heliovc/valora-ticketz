import GetTicketWbot from "../../helpers/GetTicketWbot";
import Message from "../../models/Message";
import { SalesAiConfig } from "../../models/SalesAi";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { getJidOf } from "../WbotServices/getJidOf";
import { verifyMediaMessage } from "../WbotServices/wbotMessageListener";
import { registrarEnvio } from "./SalesAiService";
import { produtoDaConversa, videoDoProduto } from "./salesAiRules";

const NOME_DO_ARQUIVO = "demonstracao.mp4";

/**
 * Envia pelo QR o vídeo de demonstração do produto, quando a IA pede com
 * `[[VIDEO]]`. Uma vez só por conversa: quem já recebeu não recebe de novo.
 *
 * Falha aqui nunca derruba a conversa: o texto já saiu, e o lead segue atendido
 * sem o vídeo.
 */
export async function enviarVideoDeVendas(ticket: Ticket, cfg: SalesAiConfig): Promise<boolean> {
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
