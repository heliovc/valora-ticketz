import AppError from "../../errors/AppError";
import FunnelAction from "../../models/FunnelAction";
import Tag from "../../models/Tag";
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

export async function listarAcoes(
  companyId: number,
  tagId: number | null
): Promise<FunnelAction[]> {
  await assertListaDaEmpresa(tagId, companyId);
  return FunnelAction.findAll({
    where: { companyId, tagId } as any,
    order: [["ordem", "ASC"]]
  });
}

function validar(dados: DadosDaAcao): void {
  if (!dados.tipo || !TIPOS_CONHECIDOS.includes(dados.tipo as any)) {
    throw new AppError("ERR_FUNNEL_ACTION_TYPE", 400);
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
  tagId: number | null,
  dados: DadosDaAcao
): Promise<FunnelAction> {
  await assertListaDaEmpresa(tagId, companyId);
  validar(dados);

  const quantas = await FunnelAction.count({ where: { companyId, tagId } as any });
  if (quantas >= MAX_ACOES_POR_LISTA) {
    throw new AppError("ERR_FUNNEL_ACTION_LIMIT", 400);
  }

  return FunnelAction.create({
    companyId,
    tagId,
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
  await acao.update(dados as any);
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
