import { checkCompanyCompliant } from "../../helpers/CheckCompanyCompliant";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import OldMessage from "../../models/OldMessage";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { aoGravarMensagemNossa } from "../SalesAiServices/SalesAiService";

interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  ack?: number;
  queueId?: number;
  channel?: string;
  /** Quem enviou (mensagens nossas): ai | humano | automacao | sistema. */
  sentBy?: string;
}
interface Request {
  messageData: MessageData;
  companyId: number;
  skipWebsocket?: boolean;
}

export const websocketCreateMessage = (message: Message) => {
  const io = getIO();
  io.to(message.ticketId.toString())
    .to(`company-${message.companyId}-${message.ticket.status}`)
    .to(`company-${message.companyId}-notification`)
    .to(`queue-${message.ticket.queueId}-${message.ticket.status}`)
    .to(`queue-${message.ticket.queueId}-notification`)
    .emit(`company-${message.companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });
};

const CreateMessageService = async ({
  messageData,
  companyId,
  skipWebsocket
}: Request): Promise<Message> => {
  await Message.upsert({ ...messageData, companyId });

  // Quem falou por último — é o que o Funil usa para marcar "sem resposta".
  // Fica aqui porque toda mensagem de todo canal passa por este serviço.
  // `silent`: não mexe no `updatedAt`, que ordena as colunas do Funil.
  const fromMe = !!messageData.fromMe;
  await Ticket.update(
    {
      lastMessageFromMe: fromMe,
      ...(fromMe ? {} : { lastClientMessageAt: new Date() }),
      // O chat do site nunca gravava `lastMessage`: o card do Funil ficava sem
      // a prévia da conversa. Os outros canais gravam por conta própria.
      ...(messageData.channel === "webchat" && messageData.body
        ? { lastMessage: messageData.body.slice(0, 255).replace(/\n/g, " ") }
        : {})
    },
    { where: { id: messageData.ticketId }, silent: true }
  );

  const message = await Message.findOne({
    where: {
      id: messageData.id,
      ticketId: messageData.ticketId
    },
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          {
            model: Contact,
            as: "contact",
            include: ["tags", "extraInfo"]
          },
          "queue",
          "tags",
          "user",
          {
            model: Whatsapp,
            as: "whatsapp",
            attributes: ["name", "id"]
          }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"],
        where: {
          companyId
        },
        required: false
      },
      {
        model: OldMessage,
        as: "oldMessages",
        where: {
          ticketId: messageData.ticketId
        },
        required: false
      }
    ]
  });

  await message.ticket.contact.update({ presence: "available" });
  await message.ticket.contact.reload();

  if (message.ticket.queueId !== null && message.queueId === null) {
    await message.update({ queueId: message.ticket.queueId });
  }

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  // Val Vendas: grava quem enviou (a IA conta para os limites do painel).
  aoGravarMensagemNossa(message, messageData.sentBy);

  if (!(await checkCompanyCompliant(companyId))) {
    return message;
  }

  const io = getIO();

  if (!skipWebsocket) {
    websocketCreateMessage(message);
  }
  
  io.to(`company-${companyId}-mainchannel`).emit(
    `company-${companyId}-contact`,
    {
      action: "update",
      contact: message.ticket.contact
    }
  );
  logger.debug(
    {
      company: companyId,
      ticket: message.ticketId,
      queue: message.ticket.queueId,
      status: message.ticket.status
    },
    "sending appMessage event"
  );
  return message;
};

export default CreateMessageService;
