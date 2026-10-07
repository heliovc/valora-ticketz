import { Request, Response } from "express";
import {
  apagarModelo,
  criarModelo,
  enviarModeloNaConversa,
  listarModelos
} from "../services/CloudApiServices/CloudApiTemplateService";
import {
  cancelarDisparo,
  criarDisparo,
  detalharDisparo,
  lerDestinatarios,
  listarDisparos
} from "../services/CloudApiServices/CloudApiBroadcastService";

/**
 * Modelos e disparos do WhatsApp Oficial. A empresa vem SEMPRE do token; o
 * `whatsappId` da tela só escolhe entre as conexões dela.
 */

export const templates = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await listarModelos(companyId, req.query.whatsappId as string));
};

export const createTemplate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  return res.status(201).json(await criarModelo(companyId, req.body || {}));
};

export const removeTemplate = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  await apagarModelo(companyId, req.query.whatsappId as string, req.params.name);
  return res.json({ ok: true });
};

export const sendTemplateOnTicket = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const { name, language, params } = req.body || {};
  await enviarModeloNaConversa(
    companyId,
    Number(req.params.ticketId),
    name,
    language,
    Array.isArray(params) ? params : []
  );
  return res.json({ ok: true });
};

export const broadcasts = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await listarDisparos(companyId));
};

export const broadcast = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await detalharDisparo(companyId, Number(req.params.id)));
};

/** Confere a lista colada antes de disparar: quantos válidos, quais recusados. */
export const previewRecipients = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { validos, invalidos } = lerDestinatarios(String(req.body?.contatos || ""));
  return res.json({ total: validos.length, invalidos: invalidos.slice(0, 50) });
};

export const createBroadcast = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId, id } = req.user;
  const disparo = await criarDisparo(companyId, Number(id) || null, req.body || {});
  return res.status(201).json(disparo);
};

export const cancelBroadcast = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  await cancelarDisparo(companyId, Number(req.params.id));
  return res.json({ ok: true });
};
