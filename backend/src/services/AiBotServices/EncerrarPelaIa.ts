import { Op } from "sequelize";
import Ticket from "../../models/Ticket";
import TicketNote from "../../models/TicketNote";
import { agendarAcoesDoFunil } from "../../queues/funnelAutomation";
import { EVENTO_DO_RESULTADO, ResultadoDaIa } from "../../helpers/encerramento";
import { logger } from "../../utils/logger";

const ROTULO: Record<ResultadoDaIa, string> = {
  fechado: "fechado (o cliente aceitou)",
  perdido: "perdido (o cliente recusou)"
};

/**
 * A IA concluiu que a negociação acabou: deixa a nota no card e dispara o
 * gatilho do resultado em Automações, onde cada empresa diz o que acontece
 * (mover, desligar o bot, avisar). Uma vez por resultado e conversa: a nota é a
 * marca — o modelo repetir o comando na resposta seguinte não move nem avisa de novo.
 * Nunca lança: a resposta ao cliente segue.
 */
export async function encerrarPelaIa(
  ticketId: number,
  companyId: number,
  resultado: ResultadoDaIa,
  motivo?: string
): Promise<string> {
  try {
    const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
    if (!ticket) return "conversa não encontrada";
    const marca = `🤖 A IA encerrou a negociação: ${ROTULO[resultado]}`;
    const ja = await TicketNote.findOne({
      where: { ticketId, note: { [Op.like]: `${marca}%` } } as any,
      attributes: ["id"]
    });
    if (ja) return `já encerrada como ${resultado}`;
    await TicketNote.create({
      note: motivo ? `${marca}: ${motivo.slice(0, 300)}` : `${marca}.`,
      userId: null,
      contactId: ticket.contactId,
      ticketId
    } as any);
    await agendarAcoesDoFunil(ticketId, null, companyId, EVENTO_DO_RESULTADO[resultado]);
    logger.info(`[aiBot] conversa ${ticketId} encerrada pela IA: ${resultado}`);
    return `encerrada como ${resultado}`;
  } catch (err: any) {
    logger.error({ ticketId, message: err?.message }, "[aiBot] falha ao encerrar a conversa");
    return "falhou";
  }
}
