import { Op } from "sequelize";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import FunnelAction from "../../models/FunnelAction";
import { SalesAiConfig } from "../../models/SalesAi";
import Tag from "../../models/Tag";
import TagAutomationRun from "../../models/TagAutomationRun";
import Ticket from "../../models/Ticket";
import TicketNote from "../../models/TicketNote";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import { isOficial } from "../../helpers/channelTraits";
import { brNumberVariants } from "../../helpers/brPhone";
import { logger } from "../../utils/logger";
import { listasDoQuadro, moverParaLista } from "../AiBotServices/AcoesDoBot";
import { ehNumeroDaEmpresa } from "../AiBotServices/NumerosProprios";
import { importarParaLista } from "../FunnelImportServices/ImportarParaListaService";
import { botDaAcao } from "../TagServices/funnelActionRules";
import UpdateTicketService from "../TicketServices/UpdateTicketService";
import {
  IndicacaoDoLead,
  ProdutoDeVendas,
  escolherListaDeDisparo,
  normalizarTelefone,
  produtoDaConversa
} from "./salesAiRules";

/**
 * O que a Val faz quando a conversa sai das mãos dela (pedido do Hélio, 10/11/2026):
 *
 * - Indicação: o lead passou o telefone de outra pessoa. A Val abre o card do
 *   indicado na lista de disparo do produto, no mesmo quadro — ele recebe a
 *   abertura de sempre — e finaliza o card de quem indicou.
 * - Transferência por assunto que a Val não resolve: o card vai para a lista
 *   "Transferido para Atendimento" do quadro dele (criada na primeira vez).
 */

export const LISTA_DE_ATENDIMENTO = "Transferido para Atendimento";
/** Campo do contato indicado: a Val lê na primeira resposta a ele. */
export const CAMPO_DA_INDICACAO = "Indicado por";
/** O card de quem indicou fecha depois de a resposta da Val sair. */
export const ESPERA_PARA_FINALIZAR_MS = 30 * 1000;

const BOT_DO_PRODUTO: Record<ProdutoDeVendas, string> = {
  elo_eventos: "val_vendas",
  valora_saude: "val_saude"
};

const normal = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Nome para o import: sem os separadores de coluna (; , tab). */
const semSeparador = (t: string) => String(t || "").replace(/[;,\t]+/g, " -").replace(/\s+/g, " ").trim();

// ── Transferido para Atendimento ────────────────────────────────────────────

/** Leva o card para a lista de atendimento humano do quadro dele, criando a lista se faltar. */
export async function moverParaAtendimento(ticket: Ticket, cfg: SalesAiConfig | null): Promise<string> {
  try {
    const nome = String((cfg?.handoff as any)?.lista || "").trim() || LISTA_DE_ATENDIMENTO;
    const listas = await listasDoQuadro(ticket);
    let lista = listas.find(l => normal(l.name) === normal(nome));
    if (!lista) {
      const conexao = ticket.whatsappId
        ? await Whatsapp.findOne({ where: { id: ticket.whatsappId, companyId: ticket.companyId }, attributes: ["id", "ownBoard"] })
        : null;
      [lista] = await Tag.findOrCreate({
        where: { companyId: ticket.companyId, name: nome, kanban: 1, whatsappId: conexao?.ownBoard ? conexao.id : null } as any,
        defaults: {
          companyId: ticket.companyId,
          name: nome,
          kanban: 1,
          color: "#E67E22",
          whatsappId: conexao?.ownBoard ? conexao.id : null
        } as any
      });
      logger.info(`[val-vendas] lista "${nome}" criada no quadro ${conexao?.ownBoard ? conexao.id : "principal"}`);
    }
    const r = await moverParaLista(ticket, lista.id);
    logger.info(`[val-vendas] ticket ${ticket.id}: transferido, ${r}`);
    return r;
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, err: err?.message }, "[val-vendas] mover para atendimento falhou");
    return "falhou";
  }
}

// ── Indicação ───────────────────────────────────────────────────────────────

/**
 * Lista de disparo do produto no quadro do card: liga a Val do produto e manda
 * a abertura na entrada (modelo no Oficial; mensagem ou gatilho da lista no QR).
 */
export async function listaDeDisparo(ticket: Ticket, produto: ProdutoDeVendas): Promise<Tag | null> {
  const listas = await listasDoQuadro(ticket);
  if (!listas.length) return null;
  const conexao = ticket.whatsappId ? await Whatsapp.findByPk(ticket.whatsappId, { attributes: ["id", "channel"] }) : null;
  const oficial = isOficial(conexao?.channel || ticket.channel);
  const acoes = await FunnelAction.findAll({
    where: { companyId: ticket.companyId, tagId: { [Op.in]: listas.map(l => l.id) }, evento: null, ativo: true } as any
  });
  const candidatas = listas.filter(l => {
    const daLista = acoes.filter(a => a.tagId === l.id);
    const ligaAVal = daLista.some(a => a.tipo === "bot_ligar" && botDaAcao(a.config as any) === BOT_DO_PRODUTO[produto]);
    const abre = oficial
      ? daLista.some(a => a.tipo === "modelo" && !a.atrasoMinutos)
      : daLista.some(a => a.tipo === "mensagem" && !a.atrasoMinutos) || !!String(l.autoMessage || "").trim();
    return ligaAVal && abre;
  });
  if (!candidatas.length) return null;
  const ids = candidatas.map(l => l.id);
  const [atuais, historico] = await Promise.all([
    TicketTag.findAll({ where: { ticketId: ticket.id, tagId: { [Op.in]: ids } }, attributes: ["tagId"] }),
    TagAutomationRun.findAll({
      where: { ticketId: ticket.id, tagId: { [Op.in]: ids } } as any,
      order: [["createdAt", "DESC"]],
      attributes: ["tagId"],
      limit: 20
    })
  ]);
  const escolhida = escolherListaDeDisparo(
    ids,
    atuais.map(t => t.tagId),
    historico.map(h => Number(h.tagId))
  );
  return candidatas.find(l => l.id === escolhida) || null;
}

export interface ResultadoDaIndicacao {
  ok: boolean;
  /** Por que não deu (vai na observação da transferência). */
  motivo?: string;
  novoTicketId?: number;
  lista?: string;
}

async function anotar(ticketId: number, contactId: number, texto: string): Promise<void> {
  await TicketNote.create({ note: texto, userId: null, contactId, ticketId } as any);
}

/** Fecha o card sem mensagem de despedida nem pesquisa de satisfação. */
export function finalizarDepois(ticketId: number, companyId: number, esperaMs = ESPERA_PARA_FINALIZAR_MS): void {
  setTimeout(() => {
    UpdateTicketService({ ticketData: { status: "closed", justClose: true } as any, ticketId, companyId })
      .then(() => logger.info(`[val-vendas] ticket ${ticketId}: finalizado depois da indicação`))
      .catch(err => logger.error({ ticketId, err: err?.message }, "[val-vendas] finalizar depois da indicação falhou"));
  }, esperaMs);
}

/**
 * Abre o card do indicado na lista de disparo e agenda o fim do card de quem
 * indicou. Nunca lança: se não der, devolve o motivo e quem chamou transfere.
 */
export async function encaminharIndicacao(
  ticket: Ticket,
  contato: Contact,
  indicacao: IndicacaoDoLead,
  resumo: string | null
): Promise<ResultadoDaIndicacao> {
  const quem = indicacao.nome ? `${indicacao.nome} (${indicacao.numero})` : indicacao.numero;
  try {
    const variantes = new Set(brNumberVariants(indicacao.numero));
    if (variantes.has(normalizarTelefone(contato.number))) {
      return { ok: false, motivo: `o número indicado (${indicacao.numero}) é o do próprio lead` };
    }
    if (await ehNumeroDaEmpresa(ticket.companyId, indicacao.numero)) {
      return { ok: false, motivo: `o número indicado (${indicacao.numero}) é da própria empresa` };
    }
    const produto = produtoDaConversa(ticket.salesSource);
    const lista = await listaDeDisparo(ticket, produto);
    if (!lista) return { ok: false, motivo: `indicou ${quem}, mas este quadro não tem lista de disparo do produto` };

    // Nome do card: "Dr. Jorge · Clínica X". Contato sem nome (só o número) não
    // entra, e nenhum número longo pode ficar no nome: a leitura da linha
    // pegaria esse número no lugar do telefone.
    const origem = /[A-Za-zÀ-ÿ]/.test(contato.name || "") ? semSeparador(contato.name) : "";
    const nomeDoCard =
      semSeparador([indicacao.nome, origem].filter(Boolean).join(" · "))
        .replace(/[\d().+-]{8,}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "Indicação";
    const r = await importarParaLista(ticket.companyId, { tagId: lista.id, contatos: `${nomeDoCard};${indicacao.numero}` });
    if (r.abordadosPeloOutroNumero) {
      return { ok: false, motivo: `indicou ${quem}, mas esse número já falou com o outro número da empresa nos últimos 30 dias` };
    }
    if (r.invalidos.length) return { ok: false, motivo: `indicou ${quem}, mas o número não é válido` };

    const novoContato = await Contact.findOne({
      where: { companyId: ticket.companyId, number: { [Op.in]: brNumberVariants(indicacao.numero) } }
    });
    const novoCard = novoContato
      ? await Ticket.findOne({
          where: { companyId: ticket.companyId, contactId: novoContato.id, status: { [Op.in]: ["open", "pending"] } },
          include: [{ model: Tag, as: "tags", where: { id: lista.id }, attributes: ["id"] }]
        })
      : null;

    const deQuem = `${contato.name || contato.number} (card ${ticket.id})`;
    if (novoContato) {
      const valor = `${contato.name || contato.number}${resumo ? ` — ${resumo}` : ""}`.slice(0, 300);
      const [campo, criado] = await ContactCustomField.findOrCreate({
        where: { contactId: novoContato.id, name: CAMPO_DA_INDICACAO },
        defaults: { contactId: novoContato.id, name: CAMPO_DA_INDICACAO, value: valor } as any
      });
      if (!criado) await campo.update({ value: valor });
    }
    if (novoCard) {
      await anotar(novoCard.id, novoCard.contactId, `🤖 Indicado por ${deQuem}${resumo ? `: ${resumo}` : "."}`);
    }
    await anotar(
      ticket.id,
      ticket.contactId,
      `🤖 A Val encaminhou a indicação de ${quem}: card ${novoCard ? novoCard.id : "novo"} na lista "${lista.name}", que dispara a abertura. Este card foi finalizado.`
    );
    finalizarDepois(ticket.id, ticket.companyId);
    logger.info(
      `[val-vendas] ticket ${ticket.id}: indicação ${indicacao.numero} → card ${novoCard?.id ?? "?"} na lista ${lista.id} (criados=${r.criados} movidos=${r.movidos} jaNaLista=${r.jaNaLista})`
    );
    return { ok: true, novoTicketId: novoCard?.id, lista: lista.name };
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, err: err?.message }, "[val-vendas] indicação falhou");
    return { ok: false, motivo: `indicou ${quem}, mas o card novo não pôde ser criado (${err?.message || "erro"})` };
  }
}

/** Contexto para a Val falar com quem foi indicado: quem passou o contato. */
export async function contextoDaIndicacao(contactId: number | null | undefined): Promise<string> {
  if (!contactId) return "";
  const campo = await ContactCustomField.findOne({ where: { contactId, name: CAMPO_DA_INDICACAO } });
  const valor = String(campo?.value || "").trim();
  if (!valor) return "";
  return `Contexto deste lead (do sistema): o contato dele foi indicado por ${valor}. Pode citar a indicação uma vez, com naturalidade, sem inventar detalhes nem expor o resumo.`;
}
