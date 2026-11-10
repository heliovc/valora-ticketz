import express, { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import Ticket from "../models/Ticket";
import Contact from "../models/Contact";
import Whatsapp from "../models/Whatsapp";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import CreateMessageService from "../services/MessageServices/CreateMessageService";
import { CHANNEL, conexaoDoTicket } from "../services/CloudApiServices/CloudApiChannel";
import {
  Botao,
  SecaoDaLista,
  dentroDaJanela,
  sendButtons,
  sendList,
  sendMediaBuffer,
  sendText
} from "../services/CloudApiServices/CloudApiSendService";

/**
 * Rotas que a Valora chama para a consultora do Conteúdo IA responder.
 * Autenticadas pelo mesmo segredo interno que este motor usa para chamar a
 * Valora (`VALORA_INTERNAL_SECRET`). Sem ele, as rotas respondem 404.
 */
export const segredoConfere = (req: Request): boolean => {
  const esperado = process.env.VALORA_INTERNAL_SECRET || "";
  const recebido = String(req.headers["x-internal-secret"] || "");
  if (esperado.length < 16 || recebido.length !== esperado.length) return false;
  return timingSafeEqual(new Uint8Array(Buffer.from(recebido)), new Uint8Array(Buffer.from(esperado)));
};

/** Vídeo de 8 s em 720p passa de 10 MB em base64; o WhatsApp aceita até 16 MB. */
export const LIMITE_DA_MIDIA = "40mb";

/**
 * Leitura do corpo da rota de envio, montada ANTES do `express.json` global.
 * A prévia do post vem em base64 e o limite padrão (100 KB) recusava toda
 * mídia com 500: a dona pedia o post e ficava sem resposta. O segredo é
 * conferido antes de ler, para ninguém de fora mandar corpo grande. O parser
 * global pula o corpo já lido.
 */
export const lerCorpoDaConsultora = [
  (req: Request, res: Response, next: NextFunction): void => {
    if (segredoConfere(req)) next();
    else res.status(404).end();
  },
  express.json({ limit: LIMITE_DA_MIDIA })
];

const MODOS = ["off", "autorizados", "todos"];

/** Texto que fica no painel para cada envio (o atendente vê o que a consultora mandou). */
export function textoDoRegistro(body: any): string {
  const base = String(body?.text || "").trim();
  if (body?.kind === "buttons") {
    const botoes = (body.buttons || []).map((b: Botao) => `[${b.title}]`).join(" ");
    return `${base}\n${botoes}`.trim();
  }
  if (body?.kind === "list") {
    const opcoes = (body.list?.sections || []).flatMap((s: SecaoDaLista) => s.rows.map(r => `• ${r.title}`));
    return `${base}\n${opcoes.join("\n")}`.trim();
  }
  if (body?.kind === "image" || body?.kind === "video" || body?.kind === "document") {
    return base || "📎 Arquivo enviado pela consultora";
  }
  return base;
}

export const send = async (req: Request, res: Response): Promise<Response> => {
  if (!segredoConfere(req)) return res.status(404).end();
  const body = req.body || {};
  const ticket = await Ticket.findByPk(Number(body.ticketId));
  if (!ticket) return res.status(404).json({ erro: "conversa_nao_encontrada" });
  const whatsapp = await conexaoDoTicket(ticket);
  if (!whatsapp) return res.status(400).json({ erro: "sem_conexao_oficial" });
  const contato = await Contact.findByPk(ticket.contactId);
  if (!contato) return res.status(404).json({ erro: "contato_nao_encontrado" });
  if (!dentroDaJanela(ticket)) return res.status(409).json({ erro: "fora_da_janela" });

  try {
    let resultado;
    switch (body.kind) {
      case "buttons":
        resultado = await sendButtons(whatsapp, contato.number, String(body.text || ""), body.buttons || []);
        break;
      case "list":
        resultado = await sendList(
          whatsapp,
          contato.number,
          String(body.text || ""),
          String(body.list?.button || "Ver opções"),
          body.list?.sections || []
        );
        break;
      case "image":
      case "video":
      case "document": {
        const arquivo = Buffer.from(String(body.media?.base64 || ""), "base64");
        if (!arquivo.length) return res.status(400).json({ erro: "midia_vazia" });
        resultado = await sendMediaBuffer(
          whatsapp,
          contato.number,
          body.kind,
          arquivo,
          String(body.media?.mimeType || "application/octet-stream"),
          String(body.media?.filename || "arquivo"),
          String(body.text || "")
        );
        break;
      }
      default:
        resultado = await sendText(whatsapp, contato.number, String(body.text || ""));
    }
    await CreateMessageService({
      messageData: {
        id: resultado.wamid,
        ticketId: ticket.id,
        contactId: contato.id,
        body: textoDoRegistro(body),
        fromMe: true,
        read: true,
        ack: 1,
        channel: CHANNEL,
        sentBy: "ai"
      },
      companyId: ticket.companyId
    });
    return res.json({ wamid: resultado.wamid });
  } catch (err: any) {
    const status = err instanceof AppError ? err.statusCode : 500;
    logger.warn({ ticketId: ticket.id, kind: body.kind, message: err?.message }, "[conteudo] envio falhou");
    return res.status(status).json({ erro: "envio_falhou", message: err?.message });
  }
};

/** Conexões do WhatsApp Oficial e o modo da consultora em cada uma. */
export const conexoes = async (req: Request, res: Response): Promise<Response> => {
  if (!segredoConfere(req)) return res.status(404).end();
  const rows = await Whatsapp.findAll({
    where: { channel: CHANNEL },
    attributes: ["id", "name", "companyId", "status", "cloudApiDisplayNumber", "valoraConteudoIa"],
    order: [["id", "ASC"]]
  });
  return res.json(
    rows.map(w => ({
      id: w.id,
      name: w.name,
      companyId: w.companyId,
      status: w.status,
      number: w.cloudApiDisplayNumber,
      modo: w.valoraConteudoIa || "off"
    }))
  );
};

export const definirModo = async (req: Request, res: Response): Promise<Response> => {
  if (!segredoConfere(req)) return res.status(404).end();
  const modo = String(req.body?.modo || "");
  if (!MODOS.includes(modo)) return res.status(400).json({ erro: "modo_invalido" });
  const w = await Whatsapp.findOne({ where: { id: Number(req.params.id), channel: CHANNEL } });
  if (!w) return res.status(404).json({ erro: "conexao_nao_encontrada" });
  await w.update({ valoraConteudoIa: modo });
  logger.info({ whatsappId: w.id, modo }, "[conteudo] modo da consultora alterado");
  return res.json({ id: w.id, modo });
};
