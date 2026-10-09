import { Request, Response } from "express";
import { camposDoBot, salvarCamposDoBot } from "../services/AiBotServices/AcoesDoBot";
import {
  descreverProvedores,
  salvarProvedores,
  testarProvedor
} from "../services/AiBotServices/AiBotProvidersService";

/** Modelos de IA do bot da empresa do token. Nunca devolve chave. */
export const index = async (req: Request, res: Response): Promise<Response> =>
  res.json(await descreverProvedores(req.user.companyId));

export const update = async (req: Request, res: Response): Promise<Response> => {
  await salvarProvedores(req.user.companyId, req.body?.provedores);
  return res.json(await descreverProvedores(req.user.companyId));
};

export const test = async (req: Request, res: Response): Promise<Response> =>
  res.json(await testarProvedor(req.user.companyId, Number(req.params.posicao) || 0));

/** Dados que o bot coleta do cliente (CRM → Bot), da empresa do token. */
export const fields = async (req: Request, res: Response): Promise<Response> =>
  res.json(await camposDoBot(req.user.companyId));

export const updateFields = async (req: Request, res: Response): Promise<Response> =>
  res.json(await salvarCamposDoBot(req.user.companyId, req.body?.campos));
