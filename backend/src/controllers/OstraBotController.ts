import { timingSafeEqual } from "crypto";
import { Request, Response } from "express";
import {
  listarPedidosParaOMac,
  receberRascunhoDoMac
} from "../services/OstraBotServices/OstraBotService";

/**
 * Rotas do Mac do Hélio (assistente Ostra Carioca). Fora do JWT do CRM: quem
 * chama é um script local, autenticado pelo `X-Ostra-Token`. Sem a variável
 * `OSTRA_BOT_WORKER_TOKEN` as rotas respondem 404, como se não existissem.
 */
const tokenConfere = (req: Request): boolean => {
  const esperado = process.env.OSTRA_BOT_WORKER_TOKEN || "";
  const recebido = String(req.headers["x-ostra-token"] || "");
  if (esperado.length < 32 || recebido.length !== esperado.length) {
    return false;
  }
  return timingSafeEqual(
    new Uint8Array(Buffer.from(recebido)),
    new Uint8Array(Buffer.from(esperado))
  );
};

export const pendentes = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (!tokenConfere(req)) return res.status(404).end();
  return res.json({ pedidos: await listarPedidosParaOMac() });
};

export const entregar = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (!tokenConfere(req)) return res.status(404).end();
  const id = Number(req.params.id);
  const { texto, erro } = req.body || {};
  if (!id) return res.status(400).json({ error: "id inválido" });
  const resultado = await receberRascunhoDoMac(id, {
    texto: typeof texto === "string" ? texto.slice(0, 4000) : undefined,
    erro: typeof erro === "string" ? erro : undefined
  });
  return res.json({ resultado });
};
