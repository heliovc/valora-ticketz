import AiUsageLog from "../../models/AiUsageLog";
import { logger } from "../../utils/logger";
import { classificarFalhaDaIa, digitalDaChave, UsoMedido } from "../../helpers/usoDaIa";

/** Quem pediu a resposta: vira as colunas de empresa, conversa, bot e canal. */
export interface ContextoDeUso {
  companyId: number;
  ticketId?: number | null;
  /** val_vendas, val_saude, follow_up, atendimento, teste, transcricao. */
  origem: string;
  /** oficial, qr, webchat. */
  canal?: string | null;
}

export interface ChaveUsada {
  provider: string;
  model: string;
  apiKey: string;
  dona?: "valora" | "empresa";
  final?: string;
}

/**
 * Grava uma chamada (ou a falha dela). Nunca lança nem atrasa a resposta ao
 * cliente: medir não pode derrubar a conversa.
 */
export async function registrarUsoDaIa(
  ctx: ContextoDeUso | null | undefined,
  chave: ChaveUsada,
  uso: UsoMedido,
  falha: unknown | null = null
): Promise<void> {
  if (!ctx?.companyId) return;
  try {
    await AiUsageLog.create({
      companyId: ctx.companyId,
      ticketId: ctx.ticketId ?? null,
      origem: String(ctx.origem || "outro").slice(0, 24),
      canal: ctx.canal ? String(ctx.canal).slice(0, 16) : null,
      provider: chave.provider,
      model: String(chave.model || "").slice(0, 120),
      chave: digitalDaChave(chave.apiKey),
      chaveFinal: chave.final || String(chave.apiKey || "").slice(-4),
      dona: chave.dona || "empresa",
      inputTokens: Math.round(uso.inputTokens || 0),
      outputTokens: Math.round(uso.outputTokens || 0),
      costUsd: uso.costUsd === null || uso.costUsd === undefined ? null : uso.costUsd.toFixed(6),
      ok: !falha,
      erro: falha ? classificarFalhaDaIa(falha) : null
    } as any);
  } catch (err: any) {
    logger.warn({ companyId: ctx.companyId, err: err?.message }, "[ia-consumo] não gravou o uso");
  }
}
