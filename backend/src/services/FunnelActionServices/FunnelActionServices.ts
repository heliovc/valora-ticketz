import AppError from "../../errors/AppError";
import FunnelAction from "../../models/FunnelAction";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { SalesAiConfig } from "../../models/SalesAi";
import { TIPOS_CONHECIDOS } from "../TagServices/funnelActionRules";

/** Teto por lista. Automação é o que queima número de WhatsApp; 10 já é muito. */
const MAX_ACOES_POR_LISTA = 10;

/** Atraso máximo: 7 dias. Acima disso o cliente já esqueceu do assunto. */
// 30 dias: a cadência de follow-up vai até o "mover para Sem resposta" no D+10.
const MAX_ATRASO_MINUTOS = 30 * 24 * 60;

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
  /** Gatilho que não é lista nem Entrada: "ia_humano". Nulo = os de sempre. */
  evento?: string | null;
}

const NOME_IA_HUMANO = "A IA passou para uma pessoa";

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
    ? { companyId, tagId: null, whatsappId: gatilho.whatsappId, evento: gatilho.evento ?? null }
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
      : a.evento === "ia_humano"
      ? a.whatsappId
        ? `${NOME_IA_HUMANO} — ${conexaoPorId.get(a.whatsappId) ?? "quadro"}`
        : NOME_IA_HUMANO
      : a.whatsappId
      ? `Conversa nova — ${conexaoPorId.get(a.whatsappId) ?? "quadro"}`
      : "Conversa nova";
    return plano;
  });
}

/** A Val Vendas só existe nas empresas que têm a configuração dela. */
async function assertBotDaEmpresa(dados: DadosDaAcao, companyId: number): Promise<void> {
  if (dados.config?.bot !== "val_vendas") return;
  if (!(await SalesAiConfig.findOne({ where: { companyId } }))) {
    throw new AppError("Esta conta não tem a Val Vendas.", 400);
  }
}

function validar(dados: DadosDaAcao): void {
  if (!dados.tipo || !TIPOS_CONHECIDOS.includes(dados.tipo as any)) {
    throw new AppError("ERR_FUNNEL_ACTION_TYPE", 400);
  }
  if (dados.tipo === "email") {
    const para = String(dados.config?.para ?? "").trim();
    // Vazio é válido: significa "avise o dono da conta", e quem resolve isso é
    // a Valora, que sabe o e-mail do titular. Se veio algo, tem de ser e-mail.
    // "responsavel" (quem está no card) e "dono" são destinos nomeados.
    if (para && para !== "responsavel" && para !== "dono" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) {
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
  if (dados.tipo === "bot_ligar") {
    const instrucao = String(dados.config?.instrucao ?? "");
    if (instrucao.length > 2000) {
      throw new AppError("A instrução do bot passa de 2000 caracteres.", 400);
    }
  }
  if (
    (dados.tipo === "bot_ligar" || dados.tipo === "bot_desligar") &&
    dados.config?.bot !== undefined &&
    !["atendimento", "val_vendas"].includes(String(dados.config.bot))
  ) {
    throw new AppError("Escolha qual bot a automação controla.", 400);
  }
  if (dados.tipo === "atribuir") {
    const ids = dados.config?.userIds;
    if (ids !== undefined && (!Array.isArray(ids) || ids.some(i => !(Number(i) > 0)))) {
      throw new AppError("Escolha as pessoas da equipe que recebem o card.", 400);
    }
    if (dados.config?.modo !== undefined && !["fixo", "rodizio"].includes(String(dados.config.modo))) {
      throw new AppError("Escolha entre pessoa fixa e rodízio.", 400);
    }
  }
  if (dados.tipo === "mover" && !(Number(dados.config?.tagId) > 0)) {
    throw new AppError("Escolha a lista para onde o card vai.", 400);
  }
  // Reserva da mensagem no WhatsApp Oficial fora da janela de 24 h.
  const reserva = dados.config?.modeloForaDaJanela as Record<string, unknown> | undefined;
  if (reserva !== undefined && reserva !== null) {
    if (dados.tipo !== "mensagem" || typeof reserva !== "object") {
      throw new AppError("Modelo reserva só vale para a ação de mensagem.", 400);
    }
    if (!String(reserva.templateName ?? "").trim()) {
      throw new AppError("Escolha o modelo reserva.", 400);
    }
    if (reserva.params && !Array.isArray(reserva.params)) {
      throw new AppError("Variáveis do modelo inválidas.", 400);
    }
  }
  if (dados.tipo === "modelo") {
    const nome = String(dados.config?.templateName ?? "").trim();
    if (!nome) throw new AppError("Escolha o modelo que será enviado.", 400);
    if (dados.config?.params && !Array.isArray(dados.config.params)) {
      throw new AppError("Variáveis do modelo inválidas.", 400);
    }
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
  await assertBotDaEmpresa(dados, companyId);
  if (dados.tipo === "mover") {
    await assertListaDaEmpresa(Number(dados.config?.tagId), companyId);
    if (Number(dados.config?.tagId) === gatilho.tagId) {
      throw new AppError("O card já está nesta lista: escolha outra de destino.", 400);
    }
  }

  const onde = ondeDoGatilho(gatilho, companyId);
  const quantas = await FunnelAction.count({ where: onde as any });
  if (quantas >= MAX_ACOES_POR_LISTA) {
    throw new AppError("ERR_FUNNEL_ACTION_LIMIT", 400);
  }

  return FunnelAction.create({
    companyId,
    tagId: gatilho.tagId,
    whatsappId: gatilho.tagId === null ? gatilho.whatsappId : null,
    evento: gatilho.tagId === null ? gatilho.evento ?? null : null,
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
  const final = { ...(acao.toJSON() as DadosDaAcao), ...dados };
  validar(final);
  await assertBotDaEmpresa(final, companyId);
  if (final.tipo === "mover") {
    await assertListaDaEmpresa(Number(final.config?.tagId), companyId);
    if (Number(final.config?.tagId) === acao.tagId) {
      throw new AppError("O card já está nesta lista: escolha outra de destino.", 400);
    }
  }
  // Só os campos da ação: gatilho e empresa não mudam por aqui.
  const {
    tagId: _t,
    whatsappId: _w,
    evento: _e,
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
    attributes: ["tagId", "whatsappId", "evento"]
  });
  const resumo: Record<string, number> = {};
  for (const a of acoes) {
    // Entrada do Funil principal = "entrada"; do quadro de uma conexão =
    // "entrada-<id>".
    const base = a.evento === "ia_humano" ? "ia_humano" : "entrada";
    const chave =
      a.tagId === null || a.tagId === undefined
        ? a.whatsappId
          ? `${base}-${a.whatsappId}`
          : base
        : String(a.tagId);
    resumo[chave] = (resumo[chave] ?? 0) + 1;
  }
  return resumo;
}
