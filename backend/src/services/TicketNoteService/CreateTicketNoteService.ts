import * as Yup from "yup";
import AppError from "../../errors/AppError";
import TicketNote from "../../models/TicketNote";
import Ticket from "../../models/Ticket";

interface TicketNoteData {
  note: string;
  userId: number;
  contactId: number;
  ticketId: number;
  companyId: number;
}

const CreateTicketNoteService = async (
  ticketNoteData: TicketNoteData
): Promise<TicketNote> => {
  const { note, ticketId, companyId } = ticketNoteData;

  const ticketnoteSchema = Yup.object().shape({
    note: Yup.string()
      .min(3, "ERR_TICKETNOTE_INVALID_NAME")
      .required("ERR_TICKETNOTE_INVALID_NAME")
  });

  try {
    await ticketnoteSchema.validate({ note });
  } catch (err) {
    throw new AppError(err.message);
  }

  // ticketId vem do CORPO da requisicao. Sem conferir a quem esse ticket
  // pertence, daria para escrever uma observacao dentro do atendimento de
  // outra empresa.
  const ticket = await Ticket.findByPk(ticketId, {
    attributes: ["id", "companyId"]
  });
  if (!ticket || ticket.companyId !== companyId) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const { companyId: _ignored, ...data } = ticketNoteData;
  const ticketNote = await TicketNote.create(data);

  return ticketNote;
};

export default CreateTicketNoteService;
