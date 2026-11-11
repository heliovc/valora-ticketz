import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
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
 * - Outro número do próprio lead (11/11/2026): o mesmo caminho da indicação,
 *   mas o card antigo só fecha se a abertura no número novo for entregue — a
 *   Meta pode segurar o modelo de marketing, e aí o lead iria se perder.
 * - Demo marcada (11/11/2026): o card vai para a lista "Agendamento" e a Val
 *   segue ligada, para remarcar se o lead voltar.
 */

export const LISTA_DE_ATENDIMENTO = "Transferido para Atendimento";
export const LISTA_DE_AGENDAMENTO = "Agendamento";
/** Campo do contato indicado: a Val lê na primeira resposta a ele. */
export const CAMPO_DA_INDICACAO = "Indicado por";
/** Campo do número novo do mesmo lead: a Val continua de onde parou. */
export const CAMPO_DO_OUTRO_NUMERO = "Outro número de";
/** Quando conferir se a abertura no número novo foi entregue (depois do card criado). */
export const CONFERIR_ENTREGA_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000];
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

/**
 * Leva o card para a lista `nome` do quadro dele, criando a lista se faltar.
 * Nunca lança: devolve o que aconteceu ("falhou" no erro).
 */
export async function moverParaListaDoQuadro(
  ticket: Ticket,
  nome: string,
  cor: string,
  opcoes: { manterBot?: boolean } = {}
): Promise<string> {
  try {
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
          color: cor,
          whatsappId: conexao?.ownBoard ? conexao.id : null
        } as any
      });
      logger.info(`[val-vendas] lista "${nome}" criada no quadro ${conexao?.ownBoard ? conexao.id : "principal"}`);
    }
    return await moverParaLista(ticket, lista.id, opcoes);
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, lista: nome, err: err?.message }, "[val-vendas] mover de lista falhou");
    return "falhou";
  }
}

/** Leva o card para a lista de atendimento humano do quadro dele, criando a lista se faltar. */
export async function moverParaAtendimento(ticket: Ticket, cfg: SalesAiConfig | null): Promise<string> {
  const nome = String((cfg?.handoff as any)?.lista || "").trim() || LISTA_DE_ATENDIMENTO;
  const r = await moverParaListaDoQuadro(ticket, nome, "#E67E22");
  logger.info(`[val-vendas] ticket ${ticket.id}: transferido, ${r}`);
  return r;
}

/**
 * Demo marcada: o card vai para "Agendamento" (nome em `handoff.listaDeAgendamento`)
 * sem desligar a Val — sair da lista de disparo a desligaria.
 */
export async function moverParaAgendamento(ticket: Ticket, cfg: SalesAiConfig | null): Promise<string> {
  const nome = String((cfg?.handoff as any)?.listaDeAgendamento || "").trim() || LISTA_DE_AGENDAMENTO;
  const r = await moverParaListaDoQuadro(ticket, nome, "#22c55e", { manterBot: true });
  logger.info(`[val-agenda] ticket ${ticket.id}: demo marcada, ${r}`);
  return r;
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

/** Situação da abertura no número novo, pela primeira mensagem nossa no card novo. */
export type EstadoDaAbertura = "entregue" | "falhou" | "enviada" | "nao_saiu";

export function estadoDaAbertura(
  primeira: { ack?: number | null; deliveryError?: string | null } | null,
  automacaoFalhou: boolean
): EstadoDaAbertura {
  if (primeira) {
    if (primeira.deliveryError || Number(primeira.ack) < 0) return "falhou";
    if (Number(primeira.ack) >= 2) return "entregue";
    return "enviada";
  }
  return automacaoFalhou ? "falhou" : "nao_saiu";
}

/** Motivo legível de por que a abertura não chegou ao número novo. */
export function motivoDaFalhaDeEntrega(numero: string, erro: string | null | undefined): string {
  const porque = String(erro || "").replace(/^Não entregue:\s*/i, "").trim();
  return `pediu para chamarmos no ${numero}, mas a Meta não entregou a mensagem nesse número${porque ? ` (${porque})` : ""}. Ligue ou chame por outro meio`;
}

/**
 * Outro número do próprio lead: o card antigo só fecha quando a abertura no
 * número novo chega. Se a Meta recusar, o card antigo vira transferência com o
 * motivo — o lead não pode ficar sem ninguém. Confere em 1, 5 e 30 minutos.
 */
export function acompanharAbertura(
  antigo: { id: number; companyId: number; contactId: number },
  novoTicketId: number,
  numero: string,
  aoFalhar: (motivo: string) => Promise<void>,
  tempos: number[] = CONFERIR_ENTREGA_MS
): void {
  const conferir = async (i: number): Promise<void> => {
    const primeira = await Message.findOne({
      where: { ticketId: novoTicketId, fromMe: true } as any,
      order: [["createdAt", "ASC"]],
      attributes: ["ack", "deliveryError"]
    });
    const marcas = await TicketTag.findAll({ where: { ticketId: novoTicketId }, include: [{ model: Tag, attributes: ["name"] }] as any });
    const automacaoFalhou = marcas.some((m: any) => normal(m.tag?.name || "") === normal("Automação falhou"));
    const estado = estadoDaAbertura(primeira, automacaoFalhou);
    const ultima = i >= tempos.length - 1;
    if (estado === "falhou") {
      const motivo = motivoDaFalhaDeEntrega(numero, (primeira as any)?.deliveryError);
      await anotar(antigo.id, antigo.contactId, `🤖 ${motivo[0].toUpperCase()}${motivo.slice(1)}. Este card voltou para você.`);
      await aoFalhar(motivo);
      logger.info(`[val-vendas] ticket ${antigo.id}: abertura no outro número ${numero} falhou → transferido`);
      return;
    }
    if (estado === "entregue" || (ultima && estado === "enviada")) {
      await anotar(antigo.id, antigo.contactId, `🤖 A abertura chegou no outro número (card ${novoTicketId}). Este card foi finalizado.`);
      finalizarDepois(antigo.id, antigo.companyId, 0);
      return;
    }
    if (ultima) {
      await anotar(
        antigo.id,
        antigo.contactId,
        `🤖 A abertura no outro número (card ${novoTicketId}) ainda não saiu — provavelmente espera o horário comercial. Este card continua aberto.`
      );
      return;
    }
    setTimeout(() => void conferir(i + 1).catch(err => logger.error({ err: err?.message }, "[val-vendas] conferir abertura falhou")), tempos[i + 1] - tempos[i]);
  };
  setTimeout(() => void conferir(0).catch(err => logger.error({ err: err?.message }, "[val-vendas] conferir abertura falhou")), tempos[0]);
}

/**
 * Abre o card do indicado (ou do outro número do próprio lead) na lista de
 * disparo e cuida do card de origem. Nunca lança: se não der, devolve o motivo
 * e quem chamou transfere. `aoFalharEntrega`: só no outro número do próprio
 * lead, chamado se a Meta não entregar a abertura.
 */
export async function encaminharIndicacao(
  ticket: Ticket,
  contato: Contact,
  indicacao: IndicacaoDoLead,
  resumo: string | null,
  aoFalharEntrega?: (motivo: string) => Promise<void>
): Promise<ResultadoDaIndicacao> {
  const proprio = !!indicacao.proprio;
  const quem = indicacao.nome ? `${indicacao.nome} (${indicacao.numero})` : indicacao.numero;
  const pedido = proprio ? `pediu para chamarmos no ${indicacao.numero}` : `indicou ${quem}`;
  try {
    const variantes = new Set(brNumberVariants(indicacao.numero));
    if (variantes.has(normalizarTelefone(contato.number))) {
      return {
        ok: false,
        motivo: proprio
          ? `pediu para chamarmos no ${indicacao.numero}, que é o próprio número desta conversa`
          : `o número indicado (${indicacao.numero}) é o do próprio lead`
      };
    }
    if (await ehNumeroDaEmpresa(ticket.companyId, indicacao.numero)) {
      return { ok: false, motivo: `${proprio ? "o número pedido" : "o número indicado"} (${indicacao.numero}) é da própria empresa` };
    }
    const produto = produtoDaConversa(ticket.salesSource);
    const lista = await listaDeDisparo(ticket, produto);
    if (!lista) return { ok: false, motivo: `${pedido}, mas este quadro não tem lista de disparo do produto` };

    // Nome do card: "Dr. Jorge · Clínica X" (indicação) ou o nome do próprio
    // lead (outro número). Contato sem nome (só o número) não entra, e nenhum
    // número longo pode ficar no nome: a leitura da linha pegaria esse número
    // no lugar do telefone.
    const origem = /[A-Za-zÀ-ÿ]/.test(contato.name || "") ? semSeparador(contato.name) : "";
    const nomeDoCard =
      semSeparador((proprio ? [origem] : [indicacao.nome, origem]).filter(Boolean).join(" · "))
        .replace(/[\d().+-]{8,}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || (proprio ? "Lead" : "Indicação");
    const r = await importarParaLista(ticket.companyId, { tagId: lista.id, contatos: `${nomeDoCard};${indicacao.numero}` });
    if (r.abordadosPeloOutroNumero) {
      return { ok: false, motivo: `${pedido}, mas esse número já falou com o outro número da empresa nos últimos 30 dias` };
    }
    if (r.invalidos.length) return { ok: false, motivo: `${pedido}, mas o número não é válido` };

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
      const campoNome = proprio ? CAMPO_DO_OUTRO_NUMERO : CAMPO_DA_INDICACAO;
      const valor = proprio
        ? `${contato.name || "o lead"}, que falou pelo ${contato.number}${resumo ? ` — ${resumo}` : ""}`.slice(0, 300)
        : `${contato.name || contato.number}${resumo ? ` — ${resumo}` : ""}`.slice(0, 300);
      const [campo, criado] = await ContactCustomField.findOrCreate({
        where: { contactId: novoContato.id, name: campoNome },
        defaults: { contactId: novoContato.id, name: campoNome, value: valor } as any
      });
      if (!criado) await campo.update({ value: valor });
    }
    if (novoCard) {
      await anotar(
        novoCard.id,
        novoCard.contactId,
        proprio
          ? `🤖 Outro número de ${deQuem}: o lead pediu para continuarmos por aqui${resumo ? `. ${resumo}` : "."}`
          : `🤖 Indicado por ${deQuem}${resumo ? `: ${resumo}` : "."}`
      );
    }
    if (proprio && novoCard && aoFalharEntrega) {
      await anotar(
        ticket.id,
        ticket.contactId,
        `🤖 O lead pediu para chamarmos no ${indicacao.numero}: card ${novoCard.id} na lista "${lista.name}", que dispara a abertura. Este card fecha quando a abertura chegar lá.`
      );
      acompanharAbertura(ticket, novoCard.id, indicacao.numero, aoFalharEntrega);
    } else {
      await anotar(
        ticket.id,
        ticket.contactId,
        proprio
          ? `🤖 O lead pediu para chamarmos no ${indicacao.numero}: card ${novoCard ? novoCard.id : "novo"} na lista "${lista.name}", que dispara a abertura. Este card foi finalizado.`
          : `🤖 A Val encaminhou a indicação de ${quem}: card ${novoCard ? novoCard.id : "novo"} na lista "${lista.name}", que dispara a abertura. Este card foi finalizado.`
      );
      finalizarDepois(ticket.id, ticket.companyId);
    }
    logger.info(
      `[val-vendas] ticket ${ticket.id}: ${proprio ? "outro número" : "indicação"} ${indicacao.numero} → card ${novoCard?.id ?? "?"} na lista ${lista.id} (criados=${r.criados} movidos=${r.movidos} jaNaLista=${r.jaNaLista})`
    );
    return { ok: true, novoTicketId: novoCard?.id, lista: lista.name };
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, err: err?.message }, "[val-vendas] indicação falhou");
    return { ok: false, motivo: `${pedido}, mas o card novo não pôde ser criado (${err?.message || "erro"})` };
  }
}

/** Contexto para a Val falar com quem foi indicado, ou com o outro número do mesmo lead. */
export async function contextoDaIndicacao(contactId: number | null | undefined): Promise<string> {
  if (!contactId) return "";
  const campos = await ContactCustomField.findAll({
    where: { contactId, name: { [Op.in]: [CAMPO_DA_INDICACAO, CAMPO_DO_OUTRO_NUMERO] } } as any
  });
  const valorDe = (nome: string) => String(campos.find(c => c.name === nome)?.value || "").trim();
  const outro = valorDe(CAMPO_DO_OUTRO_NUMERO);
  if (outro) {
    return `Contexto deste lead (do sistema): é o mesmo lead que já conversou com a Valora por outro número (${outro}) e pediu para continuarmos por este. Continue de onde a conversa parou, sem se apresentar do zero e sem expor o resumo.`;
  }
  const valor = valorDe(CAMPO_DA_INDICACAO);
  if (!valor) return "";
  return `Contexto deste lead (do sistema): o contato dele foi indicado por ${valor}. Pode citar a indicação uma vez, com naturalidade, sem inventar detalhes nem expor o resumo.`;
}
