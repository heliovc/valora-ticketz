import { Request, Response } from "express";
import { getWbot, removeWbot } from "../libs/wbot";
import ShowWhatsAppService from "../services/WhatsappService/ShowWhatsAppService";
import { StartWhatsAppSession } from "../services/WbotServices/StartWhatsAppSession";
import UpdateWhatsAppService from "../services/WhatsappService/UpdateWhatsAppService";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";

/**
 * Sobe a sessao SEM prender a resposta HTTP.
 *
 * `initWASocket` devolve uma Promise que so resolve no evento
 * `connection === "open"` — ou seja, quando o celular efetivamente conecta.
 * Dar `await` nela dentro do controller significava segurar a requisicao ate
 * alguem ler o QR Code. Na pratica a resposta nunca chegava: o gateway da
 * Valora desiste em 60s e a tela mostrava "Reiniciar" como se o botao estivesse
 * morto, mesmo com a sessao reiniciando normalmente por tras.
 *
 * O contrato destas rotas e "Starting session", nao "session started" — quem
 * acompanha o progresso e o socket, nao a resposta.
 */
const startSessionInBackground = (
  whatsapp: Whatsapp,
  companyId: number
): void => {
  StartWhatsAppSession(whatsapp, companyId).catch(() => {
    // StartWhatsAppSession ja loga o erro internamente.
  });
};

const store = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId);

  if (whatsapp && whatsapp.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  startSessionInBackground(whatsapp, companyId);

  return res.status(200).json({ message: "Starting session." });
};

const update = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const { whatsapp } = await UpdateWhatsAppService({
    whatsappId,
    companyId,
    whatsappData: { session: "" }
  });

  if (whatsapp.channel === "whatsapp") {
    // A sessao antiga precisa sair de `sessions[]` antes da nova entrar: o
    // `initWASocket` so faz `push` quando nao acha o id na lista, entao sem
    // isto o socket novo nascia orfao e `getWbot()` continuava devolvendo o
    // socket morto — a conexao "reiniciava" e todo envio seguia falhando.
    await removeWbot(whatsapp.id, false);
    startSessionInBackground(whatsapp, companyId);
  }

  return res.status(200).json({ message: "Starting session." });
};

const remove = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId);

  if (whatsapp && whatsapp.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  if (whatsapp.channel === "whatsapp") {
    const wbot = getWbot(whatsapp.id);
    wbot.logout();
    wbot.ws.close();
  }

  if (whatsapp.channel === "facebook" || whatsapp.channel === "instagram") {
    whatsapp.destroy();
  }

  return res.status(200).json({ message: "Session disconnected." });
};

const refresh = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params;
  const { companyId } = req.user;

  const whatsapp = await ShowWhatsAppService(whatsappId);

  if (whatsapp && whatsapp.companyId !== companyId) {
    throw new AppError("ERR_FORBIDDEN", 403);
  }

  if (!whatsapp) {
    throw new AppError("ERR_NO_WAPP_FOUND", 404);
  }

  if (whatsapp.channel === "whatsapp") {
    const wbot = getWbot(whatsapp.id);
    if (!wbot) {
      return res.status(404).json({ message: "Session not found." });
    }
    await wbot.ws.close();
    return res.status(200).json({ message: "Session refreshed." });
  }

  return res.status(400).json({ message: "Session not supported." });
};

export default { store, remove, update, refresh };
