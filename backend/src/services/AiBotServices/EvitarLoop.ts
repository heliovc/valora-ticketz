import Message from "../../models/Message";
import {
  MENSAGENS_PARA_ANALISE,
  MotivoDoLoop,
  motivoDoLoop
} from "../../helpers/evitarLoopDeBots";

/** Lê a conversa e aplica as regras de `evitarLoopDeBots`. */
export async function motivoDoLoopNaConversa(
  ticketId: number,
  etapa?: string | null
): Promise<MotivoDoLoop | null> {
  const linhas = await Message.findAll({
    where: { ticketId, isDeleted: false },
    attributes: ["fromMe", "body", "mediaType", "sentBy", "createdAt"],
    order: [["createdAt", "DESC"]],
    limit: MENSAGENS_PARA_ANALISE
  });
  return motivoDoLoop(linhas.reverse(), etapa);
}
