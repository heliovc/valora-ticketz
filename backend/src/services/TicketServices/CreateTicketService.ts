import AppError from "../../errors/AppError";
import { Op, WhereOptions } from "sequelize";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import Ticket from "../../models/Ticket";
import ShowContactService from "../ContactServices/ShowContactService";
import { getIO } from "../../libs/socket";
import FindOrCreateATicketTrakingService from "./FindOrCreateATicketTrakingService";
import Contact from "../../models/Contact";
import { incrementCounter } from "../CounterServices/IncrementCounter";
import Whatsapp from "../../models/Whatsapp";
import User from "../../models/User";

interface Request {
  contactId: number;
  userId: number;
  companyId: number;
  queueId?: number;
  /** Conexão escolhida (ex.: a do quadro aberto). Ausente = a padrão. */
  whatsappId?: number;
}

const CreateTicketService = async ({
  contactId,
  userId,
  queueId,
  companyId,
  whatsappId
}: Request): Promise<Ticket> => {
  // Contato e atendente são conferidos ANTES de procurar conversa aberta: sem
  // isso, um contactId de outra empresa revelava se ela tinha card aberto.
  const { isGroup } = await ShowContactService(contactId, companyId);
  if (userId) {
    const atendente = await User.findOne({ where: { id: userId, companyId } });
    if (!atendente) throw new AppError("ERR_NO_USER_FOUND", 404);
  }

  // Conexão escolhida tem de ser da empresa. Conexão com quadro próprio cria
  // o card no quadro dela; sem escolha, vale a padrão (Baileys).
  const escolhida = whatsappId
    ? await Whatsapp.findOne({ where: { id: whatsappId, companyId } })
    : null;
  if (whatsappId && !escolhida) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }
  const conexao = escolhida || (await GetDefaultWhatsApp(companyId));

  // Um número, um card POR QUADRO: contato com card aberto na conexão B,
  // default é a A, atendente abre "Nova conversa" — antes isso criava o
  // SEGUNDO card (ver `ticketLookupRules.ts`). Conexão com quadro próprio tem
  // os cards dela; as demais dividem o Funil principal.
  const comQuadroProprio = (
    await Whatsapp.findAll({
      where: { companyId, ownBoard: true },
      attributes: ["id"]
    })
  ).map(w => w.id);
  let doQuadro: WhereOptions<Ticket> = {};
  if (conexao.ownBoard) {
    doQuadro = { whatsappId: conexao.id };
  } else if (comQuadroProprio.length) {
    doQuadro = {
      [Op.or]: [
        { whatsappId: null },
        { whatsappId: { [Op.notIn]: comQuadroProprio } }
      ]
    };
  }
  let ticket = await Ticket.findOne({
    where: {
      contactId,
      companyId,
      status: { [Op.or]: ["open", "pending"] },
      ...doQuadro
    }
  });

  const include = [
    {
      model: Contact,
      as: "contact",
      include: ["tags", "extraInfo"]
    },
    "queue",
    "whatsapp",
    "user",
    "tags"
  ];

  if (ticket) {
    // Card aberto no mesmo quadro e sem atendente (ou do próprio atendente):
    // a "nova conversa" continua nele — um número, um card. Antes isso dava
    // erro e obrigava a achar e finalizar o card só para poder escrever.
    const livre = !ticket.userId || (userId && ticket.userId === Number(userId));
    if (livre) {
      if (ticket.status !== "open" || (userId && !ticket.userId)) {
        await ticket.update({
          status: "open",
          ...(userId && !ticket.userId ? { userId } : {})
        });
      }
      await ticket.reload({
        include
      });
      return ticket;
    }
    // Está com outra pessoa da equipe: não toma a conversa dela.
    const dono = await User.findOne({
      where: { id: ticket.userId, companyId },
      attributes: ["name"]
    });
    throw new AppError(
      `Já existe uma conversa aberta com este número neste quadro${
        dono?.name ? `, em atendimento por ${dono.name}` : ""
      }.`,
      400
    );
  }

  ticket = await Ticket.create({
    contactId,
    companyId,
    queueId,
    whatsappId: conexao.id,
    // O canal vem da conexão: card criado no quadro do WhatsApp Oficial tem de
    // responder pela Meta, não pelo Baileys.
    channel: conexao.channel || "whatsapp",
    status: "open",
    isGroup,
    userId
  });

  if (!ticket) {
    throw new AppError("ERR_CREATING_TICKET");
  }

  await FindOrCreateATicketTrakingService({
    ticketId: ticket.id,
    companyId: ticket.companyId,
    whatsappId: ticket.whatsappId,
    userId: ticket.userId
  });

  incrementCounter(ticket.companyId, "ticket-create");

  await ticket.reload({
    include
  });

  const io = getIO();

  io.to(ticket.id.toString()).emit("ticket", {
    action: "update",
    ticket
  });

  return ticket;
};

export default CreateTicketService;
