import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import ShowTicketService from "../TicketServices/ShowTicketService";
import { websocketUpdateTicket } from "../TicketServices/UpdateTicketService";
import {
  agendarAcoesDoFunil,
  desligarBotAoSairDaLista
} from "../../queues/funnelAutomation";

export async function ticketTagAdd(
  ticketId: number,
  tagId: number,
  companyId?: number
) {
  const ticket = await ShowTicketService(ticketId, companyId);
  if (!Ticket) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }

  if (companyId && ticket.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  const tag = await Tag.findByPk(tagId);
  if (!tag) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }

  if (ticket.companyId !== tag.companyId) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }

  const ticketTag = await TicketTag.create({
    ticketId,
    tagId
  });

  if (!ticketTag) {
    throw new AppError("ERR_UNKNOWN", 400);
  }

  await ticket.reload();
  websocketUpdateTicket(ticket);

  // Automação da lista: este é o ponto ÚNICO por onde um card entra numa lista
  // — arraste na tela, bot, ou qualquer outro caminho. Sem await: mover um card
  // não pode ficar esperando (nem falhar por causa de) uma automação.
  void agendarAcoesDoFunil(ticketId, tagId, ticket.companyId);

  return ticketTag;
}

export async function ticketTagRemove(
  ticketId: number,
  tagId: number,
  companyId?: number
) {
  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }

  if (companyId && ticket.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  await TicketTag.destroy({
    where: {
      ticketId,
      tagId
    }
  });

  // Saiu da lista que ligava o bot: o bot cala. Mover para "Negociação", onde
  // um humano assume, não pode deixar o robô respondendo por cima dele.
  void desligarBotAoSairDaLista(ticketId, tagId, ticket.companyId);

  await ticket.reload();
  websocketUpdateTicket(ticket);
}

export async function ticketTagRemoveAll(ticketId: number, companyId?: number) {
  const ticket = await ShowTicketService(ticketId, companyId);
  if (!ticket) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }

  if (companyId && ticket.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  await TicketTag.destroy({
    where: {
      ticketId
    }
  });

  await ticket.reload();
  websocketUpdateTicket(ticket);
}
