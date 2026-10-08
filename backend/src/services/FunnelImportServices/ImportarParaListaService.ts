import { Op, WhereOptions } from "sequelize";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { brNumberVariants } from "../../helpers/brPhone";
import { lerDestinatarios } from "../CloudApiServices/CloudApiBroadcastService";
import FindOrCreateATicketTrakingService from "../TicketServices/FindOrCreateATicketTrakingService";
import { ticketTagAdd, ticketTagRemove } from "../TicketTagServices/TicketTagServices";

/**
 * Sobe contatos em lote para uma lista do Funil: cada número vira um card na
 * lista escolhida, no quadro escolhido. Nenhuma mensagem sai daqui — o que
 * acontece depois é o que o usuário configurou nas automações das listas.
 *
 * O card entra pela mesma porta de sempre (`ticketTagAdd`), então uma
 * automação na própria lista de destino dispara, igual a arrastar o card.
 */

const MAX_POR_IMPORTACAO = 2000;

export interface ResultadoDaImportacao {
  criados: number;
  movidos: number;
  jaNaLista: number;
  invalidos: string[];
}

export async function importarParaLista(
  companyId: number,
  dados: { tagId: number; contatos: string }
): Promise<ResultadoDaImportacao> {
  const lista = await Tag.findOne({
    where: { id: Number(dados.tagId) || 0, companyId, kanban: 1 }
  });
  if (!lista) throw new AppError("Lista não encontrada.", 404);

  // O quadro é o da lista: lista de quadro próprio cria card naquela conexão;
  // lista do Funil principal, na conexão padrão.
  const conexao = lista.whatsappId
    ? await Whatsapp.findOne({ where: { id: lista.whatsappId, companyId } })
    : await GetDefaultWhatsApp(companyId);
  if (!conexao) throw new AppError("Conexão da lista não encontrada.", 404);

  const { validos, invalidos } = lerDestinatarios(dados.contatos);
  if (!validos.length) throw new AppError("Nenhum número válido na lista.", 400);
  if (validos.length > MAX_POR_IMPORTACAO) {
    throw new AppError(
      `No máximo ${MAX_POR_IMPORTACAO} contatos por vez (a lista tem ${validos.length}).`,
      400
    );
  }

  const comQuadroProprio = (
    await Whatsapp.findAll({ where: { companyId, ownBoard: true }, attributes: ["id"] })
  ).map(w => w.id);
  const doQuadro: WhereOptions<Ticket> = conexao.ownBoard
    ? { whatsappId: conexao.id }
    : comQuadroProprio.length
    ? {
        [Op.or]: [
          { whatsappId: null },
          { whatsappId: { [Op.notIn]: comQuadroProprio } }
        ]
      }
    : {};

  const listasDoQuadro = (
    await Tag.findAll({
      where: { companyId, kanban: 1, whatsappId: lista.whatsappId ?? null },
      attributes: ["id"]
    })
  ).map(t => t.id);

  const resultado: ResultadoDaImportacao = {
    criados: 0,
    movidos: 0,
    jaNaLista: 0,
    invalidos
  };

  for (const destinatario of validos) {
    // eslint-disable-next-line no-await-in-loop
    let contato = await Contact.findOne({
      where: {
        companyId,
        number: { [Op.in]: brNumberVariants(destinatario.number) }
      }
    });
    if (contato && destinatario.name && /^\d+$/.test(contato.name || "")) {
      // Contato que só tinha o número como nome ganha o nome da planilha.
      // eslint-disable-next-line no-await-in-loop
      await contato.update({ name: destinatario.name });
    }
    if (!contato) {
      // eslint-disable-next-line no-await-in-loop
      contato = await Contact.create({
        companyId,
        name: destinatario.name || destinatario.number,
        number: destinatario.number,
        email: ""
      } as any);
    }

    // eslint-disable-next-line no-await-in-loop
    let card = await Ticket.findOne({
      where: {
        contactId: contato.id,
        companyId,
        status: { [Op.or]: ["open", "pending"] },
        ...doQuadro
      }
    });
    if (!card) {
      // eslint-disable-next-line no-await-in-loop
      card = await Ticket.create({
        contactId: contato.id,
        companyId,
        whatsappId: conexao.id,
        channel: conexao.channel || "whatsapp",
        status: "open",
        isGroup: false
      } as any);
      // eslint-disable-next-line no-await-in-loop
      await FindOrCreateATicketTrakingService({
        ticketId: card.id,
        companyId,
        whatsappId: conexao.id,
        userId: null
      } as any);
      resultado.criados += 1;
    } else {
      // Card que já existe vira "atendendo" para sair da Entrada e ir à lista.
      if (card.status === "pending") {
        // eslint-disable-next-line no-await-in-loop
        await card.update({ status: "open" });
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const etapas = await TicketTag.findAll({
      where: { ticketId: card.id, tagId: { [Op.in]: listasDoQuadro } }
    });
    if (etapas.some(e => e.tagId === lista.id)) {
      resultado.jaNaLista += 1;
      continue;
    }
    for (const etapa of etapas) {
      // eslint-disable-next-line no-await-in-loop
      await ticketTagRemove(card.id, etapa.tagId, companyId);
    }
    if (etapas.length) resultado.movidos += 1;
    // eslint-disable-next-line no-await-in-loop
    await ticketTagAdd(card.id, lista.id, companyId);
  }

  return resultado;
}
