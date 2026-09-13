import { subMinutes } from "date-fns";
import { Op } from "sequelize";
import { Mutex } from "async-mutex";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import sequelize from "../../database";
import Whatsapp from "../../models/Whatsapp";
import Queue from "../../models/Queue";
import { incrementCounter } from "../CounterServices/IncrementCounter";
import {
  filtroDeCardAberto,
  precisaMigrarConexao
} from "./ticketLookupRules";

const createTicketMutex = new Mutex();

type FindOrCreateTicketOptions = {
  groupContact?: Contact;
  incrementUnread?: boolean;
  doNotReopen?: boolean;
  findOnly?: boolean;
  queue?: Queue;
};

const internalFindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  companyId: number,
  {
    groupContact,
    incrementUnread,
    doNotReopen,
    findOnly,
    queue
  }: FindOrCreateTicketOptions = {}
): Promise<{ ticket: Ticket; justCreated: boolean }> => {
  let justCreated = false;
  const isGroup = !!groupContact;
  const result = await sequelize.transaction(async () => {
    // Um número, um card: a conversa 1:1 é procurada por EMPRESA, não por
    // conexão. Quem decide o filtro (e por que grupo é diferente) é
    // `ticketLookupRules.ts`, que tem teste. Não reintroduzir `whatsappId`
    // aqui — foi isso que deixou cards presos em conexão morta em 09/09/2026.
    let ticket = await Ticket.findOne({
      where: {
        status: {
          [Op.or]: ["open", "pending"]
        },
        ...filtroDeCardAberto({
          contactId: groupContact ? groupContact.id : contact.id,
          companyId,
          whatsappId,
          isGroup
        })
      },
      order: [["id", "DESC"]]
    });

    // Card veio de outra conexão: passa para a que recebeu a mensagem, senão
    // a resposta do atendente sai por ela (`GetTicketWbot`) — ou não sai, se a
    // antiga caiu. O TicketTraking guarda a conexão também e alimenta os
    // relatórios; sem atualizá-lo o atendimento fica atribuído ao número morto.
    if (ticket && precisaMigrarConexao(ticket.whatsappId, whatsappId, isGroup)) {
      await ticket.update({ whatsappId });
      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId,
        userId: ticket.userId
      });
    }

    if (ticket && incrementUnread) {
      await ticket.increment("unreadMessages");
      ticket = await ticket.reload();
    }

    if (!ticket && groupContact) {
      ticket = await Ticket.findOne({
        where: {
          contactId: groupContact.id,
          whatsappId
        },
        order: [["updatedAt", "DESC"]]
      });

      if (ticket) {
        await ticket.update({
          status: "pending",
          userId: null,
          unreadMessages: incrementUnread
            ? ticket.unreadMessages + 1
            : ticket.unreadMessages,
          companyId
        });
        await FindOrCreateATicketTrakingService({
          ticketId: ticket.id,
          companyId,
          whatsappId: ticket.whatsappId,
          userId: ticket.userId
        });
      }
    }

    // Reabertura de card FECHADO segue escopada por conexão de propósito: com
    // `autoReopenTimeout` = 0 (o padrão) este ramo é morto, e a regra pedida é
    // justamente que conversa finalizada NÃO volte. Não "consertar" por simetria.
    if (!doNotReopen && !ticket && !groupContact) {
      const reopenTimeout = parseInt(
        await GetCompanySetting(companyId, "autoReopenTimeout", "0"),
        10
      );
      ticket =
        reopenTimeout &&
        (await Ticket.findOne({
          where: {
            updatedAt: {
              [Op.between]: [
                +subMinutes(new Date(), reopenTimeout),
                +new Date()
              ]
            },
            contactId: contact.id,
            whatsappId
          },
          order: [["updatedAt", "DESC"]]
        }));

      if (ticket) {
        await ticket.update({
          status: "pending",
          userId: null,
          unreadMessages: incrementUnread
            ? ticket.unreadMessages + 1
            : ticket.unreadMessages,
          companyId
        });
        await FindOrCreateATicketTrakingService({
          ticketId: ticket.id,
          companyId,
          whatsappId: ticket.whatsappId,
          userId: ticket.userId
        });
      }
    }

    let queueId = queue?.id || null;

    if (groupContact) {
      const whatsapp = await Whatsapp.findByPk(whatsappId, {
        include: ["queues"]
      });

      if (whatsapp?.queues.length === 1) {
        queueId = whatsapp.queues[0].id;
      }
    }

    if (findOnly && !ticket) {
      return { ticket: null, justCreated: false };
    }

    if (!ticket) {
      ticket = await Ticket.create({
        contactId: groupContact ? groupContact.id : contact.id,
        status: "pending",
        isGroup: !!groupContact,
        unreadMessages: incrementUnread ? 1 : 0,
        whatsappId,
        queueId,
        companyId
      });

      justCreated = true;

      await FindOrCreateATicketTrakingService({
        ticketId: ticket.id,
        companyId,
        whatsappId,
        userId: ticket.userId
      });
    }

    ticket = await ShowTicketService(ticket.id, companyId);

    return { ticket, justCreated };
  });

  if (result.justCreated) {
    incrementCounter(companyId, "ticket-create");
  }

  return result;
};

const FindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  companyId: number,
  options: FindOrCreateTicketOptions = {}
): Promise<{ ticket: Ticket; justCreated: boolean }> => {
  const release = await createTicketMutex.acquire();

  try {
    return await internalFindOrCreateTicketService(
      contact,
      whatsappId,
      companyId,
      options
    );
  } finally {
    release();
  }
};

export default FindOrCreateTicketService;
