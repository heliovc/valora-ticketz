import { Request, Response } from "express";
import {
  listarAcoes,
  listarTodasAsAcoes,
  criarAcao,
  atualizarAcao,
  apagarAcao,
  resumoDeAcoes
} from "../services/FunnelActionServices/FunnelActionServices";

/** `tagId` = "entrada" significa automação de conversa nova (sem lista). */
function lerTagId(bruto: string): number | null {
  if (bruto === "entrada" || bruto === "null") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
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
  const acoes = await listarAcoes(companyId, lerTagId(req.params.tagId));
  return res.json(acoes);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const acao = await criarAcao(companyId, lerTagId(req.params.tagId), req.body);
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
