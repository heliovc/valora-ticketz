import { Request, Response } from "express";
import AppError from "../errors/AppError";
import {
  Gatilho,
  listarAcoes,
  listarTodasAsAcoes,
  criarAcao,
  atualizarAcao,
  apagarAcao,
  resumoDeAcoes
} from "../services/FunnelActionServices/FunnelActionServices";

/**
 * O gatilho vem na rota: `entrada` = conversa nova do Funil principal,
 * `entrada-<id>` = conversa nova do quadro da conexão `<id>`, número = lista.
 * Qualquer outra coisa é 404 — antes, lixo na rota virava "Entrada" calado.
 */
function lerGatilho(bruto: string): Gatilho {
  if (bruto === "entrada" || bruto === "null") {
    return { tagId: null, whatsappId: null };
  }
  const quadro = /^entrada-(\d+)$/.exec(bruto);
  if (quadro) return { tagId: null, whatsappId: Number(quadro[1]) };
  const n = Number(bruto);
  if (Number.isInteger(n) && n > 0) return { tagId: n, whatsappId: null };
  throw new AppError("ERR_NOT_FOUND", 404);
}

export const todas = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await listarTodasAsAcoes(companyId));
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const acoes = await listarAcoes(companyId, lerGatilho(req.params.tagId));
  return res.json(acoes);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const acao = await criarAcao(companyId, lerGatilho(req.params.tagId), req.body);
  return res.status(201).json(acao);
};

export const update = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const acao = await atualizarAcao(companyId, +req.params.actionId, req.body);
  return res.json(acao);
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  await apagarAcao(companyId, +req.params.actionId);
  return res.json({ ok: true });
};

export const resumo = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await resumoDeAcoes(companyId));
};
