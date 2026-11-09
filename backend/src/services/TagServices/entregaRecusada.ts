import { Op } from "sequelize";
import FunnelAction from "../../models/FunnelAction";
import Message from "../../models/Message";
import Tag from "../../models/Tag";
import TagAutomationRun from "../../models/TagAutomationRun";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { avisarFalhaDaAutomacao } from "./avisarFalhaDaAutomacao";
import { textoDaFalha } from "./funnelActionRules";

/**
 * Recusa de entrega que a Meta avisa DEPOIS de aceitar o envio.
 *
 * No WhatsApp Oficial o envio volta com sucesso (a Meta devolve o `wamid`) e só
 * minutos depois chega o status `failed`: número sem WhatsApp, bloqueado, fora
 * da regra de marketing. A automação já tinha contado como enviada, então o
 * card ficava sem a etiqueta vermelha e o "uma vez só" impedia reenviar. Caso
 * do Hélio em 09/11/2026, com o próprio número na lista Disparo Saude.
 */

/** Folga entre a mensagem gravada e o `sentAt` da execução que a enviou. */
export const JANELA_DA_EXECUCAO_MS = 5 * 60 * 1000;

export interface ExecucaoCandidata {
  id: number;
  sentAt: Date | null;
  tipo: string | null;
}

/** A execução de envio (mensagem ou modelo) com `sentAt` mais perto da mensagem, dentro da folga. */
export function escolherExecucao(
  execucoes: ExecucaoCandidata[],
  mensagemEm: Date
): ExecucaoCandidata | null {
  const alvo = mensagemEm.getTime();
  let melhor: ExecucaoCandidata | null = null;
  let menor = Infinity;
  for (const e of execucoes) {
    if (!e.sentAt || (e.tipo !== "mensagem" && e.tipo !== "modelo")) continue;
    const distancia = Math.abs(new Date(e.sentAt).getTime() - alvo);
    if (distancia <= JANELA_DA_EXECUCAO_MS && distancia < menor) {
      melhor = e;
      menor = distancia;
    }
  }
  return melhor;
}

/**
 * Mensagem de automação recusada pela Meta: a execução volta a "não saiu" (o
 * card pode ser movido de novo para reenviar) e o card ganha a etiqueta
 * "Automação falhou" com a nota do motivo. Nunca lança.
 */
export async function marcarEntregaRecusada(mensagem: Message, motivo: string): Promise<void> {
  try {
    if (mensagem.sentBy !== "automacao") return;
    const ticket = await Ticket.findOne({
      where: { id: mensagem.ticketId, companyId: mensagem.companyId }
    });
    if (!ticket) return;

    const em = new Date(mensagem.createdAt);
    const execucoes = await TagAutomationRun.findAll({
      where: {
        ticketId: ticket.id,
        companyId: ticket.companyId,
        sentAt: {
          [Op.between]: [
            new Date(em.getTime() - JANELA_DA_EXECUCAO_MS),
            new Date(em.getTime() + JANELA_DA_EXECUCAO_MS)
          ]
        }
      } as any,
      include: [{ model: FunnelAction, as: "action", attributes: ["id", "tipo", "tagId"], required: false }]
    });
    const escolhida = escolherExecucao(
      execucoes.map(r => ({ id: r.id, sentAt: r.sentAt, tipo: (r as any).action?.tipo ?? null })),
      em
    );

    const frase = motivo.replace(/\.\s*$/, "");
    let lista: string | null = null;
    if (escolhida) {
      const execucao = execucoes.find(r => r.id === escolhida.id);
      await execucao?.update({ sentAt: null, skippedReason: textoDaFalha(frase) } as any);
      const tagId = (execucao as any)?.action?.tagId;
      lista = tagId ? (await Tag.findByPk(tagId))?.name ?? null : null;
    }
    await avisarFalhaDaAutomacao(ticket, lista, frase);
    logger.info(`[funnel] entrega recusada ticket=${ticket.id} execucao=${escolhida?.id ?? "-"}: ${frase}`);
  } catch (err: any) {
    logger.warn({ message: err?.message, wamid: mensagem?.id }, "[funnel] não deu para marcar a entrega recusada");
  }
}
