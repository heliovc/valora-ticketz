import { subHours } from "date-fns";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Setting from "../../models/Setting";

interface TicketData {
  status?: string;
  companyId?: number;
  unreadMessages?: number;
}

/**
 * Acha ou cria a conversa de um canal sem sessão (WhatsApp Oficial, Chat do
 * Site).
 *
 * Todas as buscas ficam presas à CONEXÃO (`whatsappId`), não só ao canal: com
 * quadro próprio por conexão, achar a conversa do mesmo contato em outro número
 * puxava o card de um quadro para o outro. `criada` diz se a conversa entrou
 * agora na Entrada (nova ou reaberta depois de finalizada) — é o gatilho das
 * automações de conversa nova.
 */
export const FindOrCreateTicketServiceMetaComEstado = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  companyId: number,
  channel: string
): Promise<{ ticket: Ticket; criada: boolean }> => {
  let criada = false;
  let ticket = await Ticket.findOne({
    where: {
      status: {
        [Op.or]: ["open", "pending"]
      },
      contactId: contact.id,
      companyId,
      whatsappId,
      channel
    },
    order: [["id", "DESC"]]
  });

  if (ticket) {
    await ticket.update({ unreadMessages });
  }

  if (!ticket) {
    ticket = await Ticket.findOne({
      where: {
        contactId: contact.id,
        companyId,
        whatsappId,
        channel
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      // Conversa finalizada que volta: entra de novo na Entrada.
      criada = true;
      await ticket.update({
        status: "pending",
        userId: null,
        unreadMessages,
        companyId,
        channel
      });
      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId: ticket.whatsappId,
        userId: ticket.userId,
        channel
      });
    }
    const msgIsGroupBlock = await Setting.findOne({
      where: { key: "timeCreateNewTicket" }
    });
  
    const value = msgIsGroupBlock ? parseInt(msgIsGroupBlock.value, 10) : 7200;
  }

  if (!ticket) {
    ticket = await Ticket.findOne({
      where: {
        updatedAt: {
          [Op.between]: [+subHours(new Date(), 2), +new Date()]
        },
        contactId: contact.id,
        companyId,
        whatsappId
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      await ticket.update({
        status: "pending",
        userId: null,
        unreadMessages,
        companyId,
        channel
      });
      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId: ticket.whatsappId,
        userId: ticket.userId,
        channel
      });
    }
  }

  if (!ticket) {
    ticket = await Ticket.create({
      contactId:contact.id,
      status: "pending",
      isGroup: false,
      unreadMessages,
      whatsappId,
      companyId,
      channel
    });
    criada = true;

    await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId,
      userId: ticket.userId,
      channel
    });

  } else {
    await ticket.update({ whatsappId });
  }

  ticket = await ShowTicketService(ticket.id, companyId);

  return { ticket, criada };
};

const FindOrCreateTicketServiceMeta = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  companyId: number,
  channel: string
): Promise<Ticket> =>
  (
    await FindOrCreateTicketServiceMetaComEstado(
      contact,
      whatsappId,
      unreadMessages,
      companyId,
      channel
    )
  ).ticket;

export default FindOrCreateTicketServiceMeta;
