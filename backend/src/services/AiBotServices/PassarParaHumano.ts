import Ticket from "../../models/Ticket";
import { websocketUpdateTicket } from "../TicketServices/UpdateTicketService";
import { logger } from "../../utils/logger";

/**
 * Depois que o bot passa a conversa para a equipe, ele sai de cena NESTE card.
 *
 * Antes nada o desligava: o cliente escrevia de novo e recebia outra vez
 * "vou chamar uma pessoa do nosso time" — foi o que aconteceu no teste de
 * 08/10. O card fica com "Bot off" e quem assume religa pelo botão, se quiser.
 */
export async function passarParaHumano(ticketId: number, companyId: number): Promise<void> {
  try {
    const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
    if (!ticket || ticket.aiBotEnabled === false) return;
    await ticket.update({ aiBotEnabled: false } as any);
    await ticket.reload();
    websocketUpdateTicket(ticket);
    logger.info(`[aiBot] conversa ${ticketId} passada para a equipe: bot desligado no card`);
  } catch (err: any) {
    logger.error({ ticketId, message: err?.message }, "[aiBot] falha ao desligar o bot após a transferência");
  }
}
