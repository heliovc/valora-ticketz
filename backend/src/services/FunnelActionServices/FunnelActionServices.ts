import AppError from "../../errors/AppError";
import FunnelAction from "../../models/FunnelAction";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { TIPOS_CONHECIDOS } from "../TagServices/funnelActionRules";

/** Teto por lista. Automação é o que queima número de WhatsApp; 10 já é muito. */
const MAX_ACOES_POR_LISTA = 10;

/** Atraso máximo: 7 dias. Acima disso o cliente já esqueceu do assunto. */
const MAX_ATRASO_MINUTOS = 7 * 24 * 60;

interface DadosDaAcao {
  tipo?: string;
  config?: Record<string, unknown>;
  atrasoMinutos?: number;
  umaVezSo?: boolean;
  soHorarioComercial?: boolean;
  ativo?: boolean;
  ordem?: number;
}

/**
 * `tagId` nulo = automação de CONVERSA NOVA (a coluna "Entrada"), que não
 * pertence a lista nenhuma. Qualquer outro valor é validado contra a empresa —
 * automação numa lista de outra empresa seria vazamento entre contas.
 */
async function assertListaDaEmpresa(
  tagId: number | null,
  companyId: number
): Promise<void> {
  if (tagId === null || tagId === undefined) return;
  const tag = await Tag.findByPk(tagId);
  if (!tag || tag.companyId !== companyId) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }
}

/**
 * Gatilho de uma automação: uma lista (`tagId`) ou a Entrada de um quadro
 * (`tagId` nulo + `whatsappId` do quadro; nulo = Funil principal).
 */
export interface Gatilho {
  tagId: number | null;
  whatsappId: number | null;
}

/** O quadro da Entrada tem de ser uma conexão da própria empresa. */
async function assertGatilhoDaEmpresa(
  gatilho: Gatilho,
  companyId: number
): Promise<void> {
  await assertListaDaEmpresa(gatilho.tagId, companyId);
  if (gatilho.tagId === null && gatilho.whatsappId) {
    const conexao = await Whatsapp.findOne({
      where: { id: gatilho.whatsappId, companyId }
    });
    if (!conexao) throw new AppError("ERR_NOT_FOUND", 404);
  }
}

const ondeDoGatilho = (gatilho: Gatilho, companyId: number) =>
  gatilho.tagId === null
    ? { companyId, tagId: null, whatsappId: gatilho.whatsappId }
    : { companyId, tagId: gatilho.tagId };

export async function listarAcoes(
  companyId: number,
  gatilho: Gatilho
): Promise<FunnelAction[]> {
  await assertGatilhoDaEmpresa(gatilho, companyId);
  return FunnelAction.findAll({
    where: ondeDoGatilho(gatilho, companyId) as any,
    order: [["ordem", "ASC"]]
  });
}

/**
 * Todas as automações da empresa, com o nome do gatilho já resolvido.
 *
 * Existe porque a automação deixou de ser um apêndice da tela de listas e
 * ganhou tela própria: sem isto, mostrar "todas as automações" exigiria uma
 * chamada por lista, e quem tem dez listas pagaria dez idas ao servidor para
 * abrir uma tela.
 */
export async function listarTodasAsAcoes(companyId: number): Promise<
  Array<FunnelAction & { nomeDoGatilho: string }>
> {
  const acoes = await FunnelAction.findAll({
    where: { companyId } as any,
    order: [
      ["tagId", "ASC"],
      ["ordem", "ASC"]
    ]
  });

  const tags = await Tag.findAll({ where: { companyId } as any });
  const nomePorId = new Map(tags.map(t => [t.id, t.name]));
  const conexoes = await Whatsapp.findAll({
    where: { companyId },
    attributes: ["id", "name"]
  });
  const conexaoPorId = new Map(conexoes.map(w => [w.id, w.name]));

  return acoes.map(a => {
    const plano = a.toJSON() as FunnelAction & { nomeDoGatilho: string };
    // `tagId` nulo é a conversa nova — não pertence a lista nenhuma, mas
    // pertence a um quadro.
    plano.nomeDoGatilho = a.tagId
      ? nomePorId.get(a.tagId) ?? `lista ${a.tagId}`
      : a.whatsappId
      ? `Conversa nova — ${conexaoPorId.get(a.whatsappId) ?? "quadro"}`
      : "Conversa nova";
    return plano;
  });
}

function validar(dados: DadosDaAcao): void {
  if (!dados.tipo || !TIPOS_CONHECIDOS.includes(dados.tipo as any)) {
    throw new AppError("ERR_FUNNEL_ACTION_TYPE", 400);
  }
  if (dados.tipo === "email") {
    const para = String(dados.config?.para ?? "").trim();
    // Vazio é válido: significa "avise o dono da conta", e quem resolve isso é
    // a Valora, que sabe o e-mail do titular. Se veio algo, tem de ser e-mail.
    if (para && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
      throw new AppError("ERR_FUNNEL_ACTION_INVALID_EMAIL", 400);
    }
  }
  if (dados.tipo === "mensagem") {
    const texto = String(dados.config?.mensagem ?? "").trim();
    // Mensagem vazia não é "desligar": para desligar existe `ativo=false` e
    // existe apagar. Gravar vazio criaria uma ação que nunca dispara e ninguém
    // entenderia por quê.
    if (!texto) throw new AppError("ERR_FUNNEL_ACTION_EMPTY_MESSAGE", 400);
  }
  const atraso = dados.atrasoMinutos ?? 0;
  if (atraso < 0 || atraso > MAX_ATRASO_MINUTOS) {
    throw new AppError("ERR_FUNNEL_ACTION_DELAY", 400);
  }
}

export async function criarAcao(
  companyId: number,
  gatilho: Gatilho,
  dados: DadosDaAcao
): Promise<FunnelAction> {
  await assertGatilhoDaEmpresa(gatilho, companyId);
  validar(dados);

  const onde = ondeDoGatilho(gatilho, companyId);
  const quantas = await FunnelAction.count({ where: onde as any });
  if (quantas >= MAX_ACOES_POR_LISTA) {
    throw new AppError("ERR_FUNNEL_ACTION_LIMIT", 400);
  }

  return FunnelAction.create({
    companyId,
    tagId: gatilho.tagId,
    whatsappId: gatilho.tagId === null ? gatilho.whatsappId : null,
    tipo: dados.tipo,
    config: dados.config ?? {},
    atrasoMinutos: dados.atrasoMinutos ?? 0,
    umaVezSo: dados.umaVezSo ?? true,
    soHorarioComercial: dados.soHorarioComercial ?? true,
    ativo: dados.ativo ?? true,
    ordem: dados.ordem ?? quantas
  } as any);
}

export async function atualizarAcao(
  companyId: number,
  actionId: number,
  dados: DadosDaAcao
): Promise<FunnelAction> {
  const acao = await FunnelAction.findByPk(actionId);
  if (!acao || acao.companyId !== companyId) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }
  // Chave ausente = não mexe; trocar o tipo revalida a configuração inteira.
  validar({ ...(acao.toJSON() as DadosDaAcao), ...dados });
  // Só os campos da ação: gatilho e empresa não mudam por aqui.
  const {
    tagId: _t,
    whatsappId: _w,
    companyId: _c,
    id: _i,
    ...permitidos
  } = dados as any;
  await acao.update(permitidos);
  return acao;
}

export async function apagarAcao(
  companyId: number,
  actionId: number
): Promise<void> {
  const acao = await FunnelAction.findByPk(actionId);
  if (!acao || acao.companyId !== companyId) {
    throw new AppError("ERR_NOT_FOUND", 404);
  }
  await acao.destroy();
}

/**
 * Quantas ações ativas cada lista tem, numa chamada só.
 *
 * A tela precisa marcar quais listas agem sozinhas. Perguntar lista por lista
 * seria uma requisição por coluna do funil.
 *
 * A chave `entrada` é a automação de conversa nova, que não tem lista.
 */
export async function resumoDeAcoes(
  companyId: number
): Promise<Record<string, number>> {
  const acoes = await FunnelAction.findAll({
    where: { companyId, ativo: true } as any,
    attributes: ["tagId", "whatsappId"]
  });
  const resumo: Record<string, number> = {};
  for (const a of acoes) {
    // Entrada do Funil principal = "entrada"; do quadro de uma conexão =
    // "entrada-<id>".
    const chave =
      a.tagId === null || a.tagId === undefined
        ? a.whatsappId
          ? `entrada-${a.whatsappId}`
          : "entrada"
        : String(a.tagId);
    resumo[chave] = (resumo[chave] ?? 0) + 1;
  }
  return resumo;
}
