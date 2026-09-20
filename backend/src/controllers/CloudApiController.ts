import { Request, Response } from "express";
import { logger } from "../utils/logger";
import { safeEqual } from "../helpers/cloudApiCrypto";
import {
  assinaturaValida,
  processarEvento
} from "../services/CloudApiServices/CloudApiWebhookService";
import {
  descreverConexao,
  revalidar,
  salvarConexao
} from "../services/CloudApiServices/CloudApiConnectionService";

/**
 * WhatsApp Oficial (Meta Cloud API) — webhook público e cadastro da conexão.
 */

/**
 * Handshake de verificação do webhook.
 *
 * A Meta chama esta rota UMA vez, ao configurar a URL no painel do App, e
 * espera o `hub.challenge` de volta como texto puro. Enquanto ela não passar,
 * não é possível sequer salvar a URL lá.
 */
export const verify = async (req: Request, res: Response): Promise<Response> => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  const esperado = process.env.META_WEBHOOK_VERIFY_TOKEN || "";

  if (!esperado) {
    logger.error("CloudApi: META_WEBHOOK_VERIFY_TOKEN não configurado");
    return res.sendStatus(403);
  }
  if (mode !== "subscribe" || !safeEqual(token, esperado)) {
    logger.warn({ mode }, "CloudApi: handshake do webhook recusado");
    return res.sendStatus(403);
  }

  return res.status(200).type("text/plain").send(challenge);
};

/**
 * Recebimento de eventos.
 *
 * Duas regras que a Meta impõe e que ditam o formato deste método:
 *
 * 1. A assinatura vem antes de tudo. Sem `X-Hub-Signature-256` válida, qualquer
 *    um que descubra a URL injeta mensagem falsa em qualquer conversa.
 * 2. Responder 200 rápido, e só depois processar. A Meta desiste em poucos
 *    segundos e reenvia em backoff — processar antes de responder transforma
 *    uma conversa movimentada numa avalanche de reentregas.
 */
export const receive = async (req: Request, res: Response): Promise<Response> => {
  const assinatura = req.headers["x-hub-signature-256"] as string | undefined;

  if (!assinaturaValida(req.rawBody, assinatura)) {
    logger.warn(
      { ip: req.ip, temAssinatura: !!assinatura },
      "CloudApi: webhook com assinatura inválida — RECUSADO"
    );
    return res.sendStatus(401);
  }

  const payload = req.body;
  res.sendStatus(200);

  // Fora do ciclo da resposta: erro daqui em diante é log, nunca reentrega.
  setImmediate(() => {
    void processarEvento(payload);
  });

  return res;
};

/** Estado da conexão para a tela (nunca devolve o token). */
export const show = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.status(200).json(await descreverConexao(companyId));
};

/** Cria ou atualiza a conexão. Só grava se a Meta aceitar as credenciais. */
export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { phoneNumberId, wabaId, token, name } = req.body || {};

  await salvarConexao(companyId, { phoneNumberId, wabaId, token, name });
  return res.status(200).json(await descreverConexao(companyId));
};

/** Revalida a credencial contra a Meta e atualiza o status. */
export const check = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const saude = await revalidar(companyId);
  return res.status(200).json(saude);
};

export default { verify, receive, show, store, check };
