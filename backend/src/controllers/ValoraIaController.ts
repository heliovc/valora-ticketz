import { Request, Response } from "express";
import { segredoConfere } from "./ValoraConteudoController";
import { resumoDoConsumo, saldoDaContaOpenRouter, situacaoDasChaves } from "../services/AiUsageServices/ConsumoDaIa";
import { logger } from "../utils/logger";

/**
 * Consumo das IAs para o admin da Valora (tela "Consumo de IA"). Mesmo segredo
 * interno da consultora do Conteúdo IA; sem ele, 404.
 */

const DIA_MS = 24 * 60 * 60 * 1000;

function lerData(valor: unknown, padrao: Date): Date {
  const d = new Date(String(valor || ""));
  return Number.isNaN(d.getTime()) ? padrao : d;
}

export const consumo = async (req: Request, res: Response): Promise<Response> => {
  if (!segredoConfere(req)) return res.status(404).end();
  const ate = lerData(req.query.ate, new Date());
  const desde = lerData(req.query.desde, new Date(ate.getTime() - 30 * DIA_MS));
  if (ate.getTime() - desde.getTime() > 366 * DIA_MS) return res.status(400).json({ error: "Período de no máximo 1 ano." });
  try {
    return res.json({ desde: desde.toISOString(), ate: ate.toISOString(), ...(await resumoDoConsumo(desde, ate)) });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[ia-consumo] resumo falhou");
    return res.status(500).json({ error: "Não deu para somar o consumo agora." });
  }
};

export const chaves = async (req: Request, res: Response): Promise<Response> => {
  if (!segredoConfere(req)) return res.status(404).end();
  try {
    const [lista, conta] = await Promise.all([situacaoDasChaves(), saldoDaContaOpenRouter()]);
    return res.json({ chaves: lista, contaOpenRouter: conta, gestaoOpenRouter: !!process.env.OPENROUTER_MANAGEMENT_KEY });
  } catch (err: any) {
    logger.error({ err: err?.message }, "[ia-consumo] chaves falhou");
    return res.status(500).json({ error: "Não deu para ler as chaves agora." });
  }
};
