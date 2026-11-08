import GetTicketWbot from "../../helpers/GetTicketWbot";
import { isOficial } from "../../helpers/channelTraits";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import { CHANNEL as CANAL_OFICIAL } from "../CloudApiServices/CloudApiChannel";
import { sendDocument } from "../CloudApiServices/CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { SalesAiConfig } from "../../models/SalesAi";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { getJidOf } from "../WbotServices/getJidOf";
import { verifyMediaMessage } from "../WbotServices/wbotMessageListener";
import { registrarEnvio } from "./SalesAiService";
import { produtoDaConversa, tabelaDoProduto } from "./salesAiRules";

const PDF = "application/pdf";

/**
 * Envia a tabela de taxas em PDF, quando a IA pede com `[[TABELA]]`. O
 * endereço é o da plataforma, que gera o arquivo na hora com as taxas e os
 * preços cadastrados: a tabela nunca fica velha.
 *
 * Sai pelo canal do card: QR (Baileys) ou WhatsApp Oficial (por link). Uma vez
 * só por conversa. Falha aqui nunca derruba a conversa: o texto já saiu.
 */
export async function enviarTabelaDeVendas(
  ticket: Ticket,
  cfg: SalesAiConfig,
  contato?: Contact
): Promise<boolean> {
  const tabela = tabelaDoProduto(cfg.produtos, produtoDaConversa(ticket.salesSource));
  if (!tabela) {
    logger.info(`[val-vendas] ticket ${ticket.id}: a IA pediu a tabela, mas o produto não tem tabela no painel`);
    return false;
  }
  try {
    const jaRecebeu = await Message.count({
      where: { ticketId: ticket.id, fromMe: true, mediaType: "application", sentBy: "ai" } as any
    });
    if (jaRecebeu) return false;

    if (isOficial(ticket.channel)) {
      const pessoa = contato || ticket.contact || (await Contact.findByPk(ticket.contactId));
      const whatsapp = ticket.whatsappId ? await Whatsapp.findByPk(ticket.whatsappId) : null;
      if (!whatsapp || !pessoa?.number) {
        logger.warn(`[val-vendas] ticket ${ticket.id}: sem conexão ou número para a tabela no Oficial`);
        return false;
      }
      const { wamid } = await sendDocument(whatsapp, pessoa.number, tabela.url, tabela.nome, "");
      await CreateMessageService({
        messageData: {
          id: wamid,
          ticketId: ticket.id,
          contactId: pessoa.id,
          body: tabela.nome,
          fromMe: true,
          read: true,
          ack: 1,
          channel: CANAL_OFICIAL,
          sentBy: "ai",
          mediaType: "application",
          mediaUrl: tabela.url
        },
        companyId: ticket.companyId
      });
      logger.info(`[val-vendas] ticket ${ticket.id}: tabela de taxas enviada pelo Oficial`);
      return true;
    }

    const wbot = await GetTicketWbot(ticket);
    const enviada = await wbot.sendMessage(getJidOf(ticket), {
      document: { url: tabela.url },
      mimetype: PDF,
      fileName: tabela.nome
    });
    registrarEnvio(enviada?.key?.id, "ai");
    await verifyMediaMessage(enviada, ticket, ticket.contact, {
      mediaInfo: { mediaUrl: tabela.url, mimetype: PDF, filename: tabela.nome }
    });
    logger.info(`[val-vendas] ticket ${ticket.id}: tabela de taxas enviada`);
    return true;
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: ticket.id }, "[val-vendas] tabela de taxas falhou");
    return false;
  }
}
