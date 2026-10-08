import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";
import { websocketUpdateTicket } from "./UpdateTicketService";
import { logger } from "../../utils/logger";

/**
 * Liga, desliga, ou devolve ao padrão da empresa, o bot de IA DESTA conversa.
 *
 * `null` apaga a decisão da conversa e volta a seguir a configuração da
 * empresa. É o que separa "desligado aqui" de "nunca foi decidido aqui" — sem
 * esse terceiro estado não haveria como desfazer um clique, e um card tocado
 * por engano ficaria preso fora do padrão para sempre.
 *
 * Fica fora do `UpdateTicketService` de propósito: aquele caminho transfere
 * fila, dispara chatbot e manda mensagem para o cliente. Trocar uma chave
 * interna não pode arriscar nada disso.
 */
const UpdateTicketAiBotService = async (
  ticketId: number,
  companyId: number,
  enabled: boolean | null
): Promise<Ticket> => {
  const ticket = await ShowTicketService(ticketId, companyId);

  await ticket.update({ aiBotEnabled: enabled } as any);
  await ticket.reload();

  logger.info(
    `[aiBot] conversa ${ticketId} (company ${companyId}): ${
      enabled === null
        ? "seguindo a empresa"
        : enabled
          ? "bot ligado"
          : "bot desligado"
    }`
  );

  // O funil de outra aba precisa ver a chave virar sem recarregar.
  websocketUpdateTicket(ticket);

  return ticket;
};

export default UpdateTicketAiBotService;
