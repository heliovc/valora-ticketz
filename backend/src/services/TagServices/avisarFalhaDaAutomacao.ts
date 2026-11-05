import { Op } from "sequelize";
import Tag from "../../models/Tag";
import TagAutomationRun from "../../models/TagAutomationRun";
import Ticket from "../../models/Ticket";
import TicketNote from "../../models/TicketNote";
import TicketTag from "../../models/TicketTag";
import { logger } from "../../utils/logger";
import { websocketUpdateTicket } from "../TicketServices/UpdateTicketService";
import { ETIQUETA_DE_FALHA, PREFIXO_DE_FALHA } from "./funnelActionRules";

const COR_DA_ETIQUETA = "#dc2626";

/**
 * Deixa a falha à vista de quem usa o funil: etiqueta vermelha no card e nota na
 * conversa com o motivo. O Hélio moveu 4 cards para a W1 em 05/11/2026, nada saiu
 * e nada avisou: o motivo só existia no log do servidor.
 *
 * Nunca lança: o aviso de uma falha não pode virar outra falha.
 */
export async function avisarFalhaDaAutomacao(
  ticket: Ticket,
  lista: string | null,
  motivo: string
): Promise<void> {
  try {
    const { companyId } = ticket;
    const [etiqueta] = await Tag.findOrCreate({
      where: { companyId, name: ETIQUETA_DE_FALHA, kanban: 0 },
      defaults: {
        companyId,
        name: ETIQUETA_DE_FALHA,
        color: COR_DA_ETIQUETA,
        kanban: 0
      } as any
    });
    await TicketTag.findOrCreate({
      where: { ticketId: ticket.id, tagId: etiqueta.id },
      defaults: { ticketId: ticket.id, tagId: etiqueta.id } as any
    });
    const origem = lista ? `da lista "${lista}"` : "desta conversa";
    await TicketNote.create({
      note: `⚠️ A automação ${origem} não funcionou: ${motivo}.`,
      userId: null,
      contactId: ticket.contactId,
      ticketId: ticket.id
    } as any);
    websocketUpdateTicket(ticket);
  } catch (err: any) {
    logger.warn(
      { ticketId: ticket.id, message: err?.message },
      "[funnel] não deu para marcar a falha no card"
    );
  }
}

export interface FalhaAberta {
  ticketId: number;
  lista: string | null;
  motivo: string;
  quando: Date;
}

/** Última falha de cada card que ainda está com a etiqueta. Só da empresa pedida. */
export async function falhasAbertas(companyId: number): Promise<FalhaAberta[]> {
  const etiqueta = await Tag.findOne({
    where: { companyId, name: ETIQUETA_DE_FALHA, kanban: 0 },
    attributes: ["id"]
  });
  if (!etiqueta) return [];
  const marcados = await TicketTag.findAll({
    where: { tagId: etiqueta.id },
    attributes: ["ticketId"]
  });
  if (!marcados.length) return [];
  const execucoes = await TagAutomationRun.findAll({
    where: {
      companyId,
      ticketId: marcados.map(m => m.ticketId),
      skippedReason: { [Op.like]: `${PREFIXO_DE_FALHA}%` }
    } as any,
    include: [{ model: Tag, as: "tag", attributes: ["name"] }],
    order: [["updatedAt", "DESC"]]
  });
  const porCard = new Map<number, FalhaAberta>();
  execucoes.forEach(r => {
    if (porCard.has(r.ticketId)) return;
    porCard.set(r.ticketId, {
      ticketId: r.ticketId,
      lista: r.tag?.name ?? null,
      motivo: String(r.skippedReason).slice(PREFIXO_DE_FALHA.length),
      quando: r.updatedAt
    });
  });
  return Array.from(porCard.values());
}
