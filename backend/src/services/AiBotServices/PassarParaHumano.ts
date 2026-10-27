import Ticket from "../../models/Ticket";
import TicketNote from "../../models/TicketNote";
import { websocketUpdateTicket } from "../TicketServices/UpdateTicketService";
import { agendarAcoesDoFunil } from "../../queues/funnelAutomation";
import { logger } from "../../utils/logger";

/** O gatilho "A IA passou para uma pessoa" da página de Gatilhos. */
export const EVENTO_IA_HUMANO = "ia_humano";

/**
 * Depois que o bot passa a conversa para a equipe, ele sai de cena NESTE card.
 *
 * Antes nada o desligava: o cliente escrevia de novo e recebia outra vez
 * "vou chamar uma pessoa do nosso time" — foi o que aconteceu no teste de
 * 08/10. O card fica com "Bot off" e quem assume religa pelo botão, se quiser.
 *
 * Também deixa uma nota no card com o motivo e dispara o gatilho
 * "A IA passou para uma pessoa": é lá que cada empresa diz para qual lista o
 * card vai e quem é avisado (pedido do Hélio, 27/10/2026).
 */
export async function passarParaHumano(
  ticketId: number,
  companyId: number,
  opcoes: { motivo?: string; falha?: boolean } = {}
): Promise<void> {
  try {
    const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
    if (!ticket || ticket.aiBotEnabled === false) return;
    await ticket.update({ aiBotEnabled: false } as any);
    await ticket.reload();
    websocketUpdateTicket(ticket);
    const motivo = opcoes.falha
      ? "a IA não conseguiu responder (modelos de IA fora do ar ou sem cota)"
      : opcoes.motivo || "o cliente pediu uma pessoa ou a IA não soube responder";
    await TicketNote.create({
      note: `🤖 A IA passou a conversa para a equipe: ${motivo}.`,
      userId: null,
      contactId: ticket.contactId,
      ticketId: ticket.id
    } as any);
    logger.info(`[aiBot] conversa ${ticketId} passada para a equipe: bot desligado no card (${motivo})`);
    await agendarAcoesDoFunil(ticket.id, null, companyId, EVENTO_IA_HUMANO);
  } catch (err: any) {
    logger.error({ ticketId, message: err?.message }, "[aiBot] falha ao desligar o bot após a transferência");
  }
}
