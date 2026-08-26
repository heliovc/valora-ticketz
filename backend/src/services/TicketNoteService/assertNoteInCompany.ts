import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import TicketNote from "../../models/TicketNote";

/**
 * Confere que a observação pertence à empresa de quem está pedindo.
 *
 * TicketNote não tem companyId próprio — o dono é o Ticket. Sem esta checagem,
 * qualquer usuário autenticado lia e editava observações de outra empresa só
 * chutando o id, porque nenhuma rota de notas filtrava por tenant.
 */
const assertNoteInCompany = async (
  id: string | number,
  companyId: number
): Promise<TicketNote> => {
  const note = await TicketNote.findByPk(id, {
    include: [{ model: Ticket, as: "ticket", attributes: ["id", "companyId"] }]
  });

  // 404 e não 403 de propósito: responder "existe, mas não é sua" já confirma
  // que aquele id existe em outra empresa.
  if (!note || note.ticket?.companyId !== companyId) {
    throw new AppError("ERR_NO_TICKETNOTE_FOUND", 404);
  }

  return note;
};

export default assertNoteInCompany;
