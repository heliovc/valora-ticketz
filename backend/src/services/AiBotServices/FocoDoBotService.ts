import { Op } from "sequelize";
import FunnelAction from "../../models/FunnelAction";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";

/**
 * O foco do bot NESTA conversa, montado a partir do que o usuário configurou.
 *
 * A persona e a base de conhecimento são da empresa inteira; o que muda de uma
 * conversa para outra é a lista em que o card está. Quem liga o bot numa lista
 * ("Ligar o Bot de IA") pode dizer ali o que o bot deve vender — é essa
 * instrução que entra aqui, junto com os nomes da lista e das etiquetas do
 * card. Lido na hora da resposta: card que muda de lista muda de foco.
 *
 * Vazio quando nada foi configurado — o prompt fica exatamente como antes.
 */
export async function focoDoBot(ticketId: number, companyId: number): Promise<string> {
  const ticket = await Ticket.findOne({
    where: { id: ticketId, companyId },
    attributes: ["id", "whatsappId"]
  });
  if (!ticket) return "";

  const marcas = await TicketTag.findAll({ where: { ticketId } });
  const tags = marcas.length
    ? await Tag.findAll({
        where: { id: { [Op.in]: marcas.map(m => m.tagId) }, companyId },
        attributes: ["id", "name", "kanban"]
      })
    : [];
  const listas = tags.filter(t => t.kanban === 1);
  const etiquetas = tags.filter(t => t.kanban !== 1);

  const instrucoes: string[] = [];
  if (listas.length) {
    const acoes = await FunnelAction.findAll({
      where: {
        companyId,
        tagId: { [Op.in]: listas.map(l => l.id) },
        tipo: "bot_ligar",
        ativo: true
      } as any
    });
    for (const lista of listas) {
      const instrucao = acoes
        .filter(a => a.tagId === lista.id)
        .map(a => String((a.config as any)?.instrucao || "").trim())
        .filter(Boolean)
        .join("\n");
      instrucoes.push(
        instrucao
          ? `Esta conversa está na etapa "${lista.name}". O que fazer aqui:\n${instrucao}`
          : `Esta conversa está na etapa "${lista.name}".`
      );
    }
  } else {
    // Card sem lista está na Entrada do quadro dele — mesma regra de quadro
    // das automações de conversa nova.
    const conexao = ticket.whatsappId
      ? await Whatsapp.findOne({
          where: { id: ticket.whatsappId, companyId },
          attributes: ["id", "ownBoard"]
        })
      : null;
    const acoes = await FunnelAction.findAll({
      where: {
        companyId,
        tagId: null,
        whatsappId: conexao?.ownBoard ? conexao.id : null,
        tipo: "bot_ligar",
        ativo: true
      } as any
    });
    const instrucao = acoes
      .map(a => String((a.config as any)?.instrucao || "").trim())
      .filter(Boolean)
      .join("\n");
    if (instrucao) instrucoes.push(`O que fazer nesta conversa:\n${instrucao}`);
  }

  if (etiquetas.length) {
    instrucoes.push(`Etiquetas deste cliente: ${etiquetas.map(e => e.name).join(", ")}.`);
  }

  // Só a etapa, sem instrução nem etiqueta, não muda o que o bot deve fazer.
  const temConteudo =
    etiquetas.length > 0 || instrucoes.some(i => i.includes("O que fazer"));
  return temConteudo ? instrucoes.join("\n\n") : "";
}
