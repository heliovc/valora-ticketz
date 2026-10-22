import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { isWhatsApp } from "../../helpers/channelTraits";
import ShowTicketService from "./ShowTicketService";
import { websocketUpdateTicket } from "./UpdateTicketService";

interface Request {
  ticketId: number;
  whatsappId: number;
  companyId: number;
}

/**
 * Troca a conexão de WhatsApp de uma conversa SEM criar outro ticket.
 *
 * Pedido do Hélio (22/10/2026): sair do WhatsApp Oficial para o número por QR
 * (ou o contrário) no meio do atendimento, com o histórico no mesmo card. O
 * envio escolhe Baileys ou Cloud API pelo `channel` do ticket, por isso ele
 * acompanha a conexão; `whatsappId` é o que `GetTicketWbot` e
 * `resolveConnection` leem para saber POR ONDE mandar.
 *
 * Só entre conexões de WhatsApp da mesma empresa e que estejam conectadas:
 * mandar a conversa para uma conexão caída seria sumir com ela em silêncio.
 */
export default async function TrocarConexaoDoTicketService({
  ticketId,
  whatsappId,
  companyId
}: Request): Promise<Ticket> {
  const ticket = await ShowTicketService(ticketId, companyId);
  if (!isWhatsApp(ticket.channel)) {
    throw new AppError("Esta conversa não é de WhatsApp.", 400);
  }
  const conexao = await Whatsapp.findOne({ where: { id: whatsappId, companyId } });
  if (!conexao) {
    throw new AppError("ERR_NO_WHATSAPP_FOUND", 404);
  }
  if (!isWhatsApp(conexao.channel)) {
    throw new AppError("Só dá para trocar entre conexões de WhatsApp.", 400);
  }
  if (conexao.status !== "CONNECTED") {
    throw new AppError("Essa conexão não está conectada.", 400);
  }
  if (ticket.whatsappId === conexao.id) return ticket;

  await ticket.update({ whatsappId: conexao.id, channel: conexao.channel });

  const atualizado = await ShowTicketService(ticketId, companyId);
  websocketUpdateTicket(atualizado);
  return atualizado;
}
