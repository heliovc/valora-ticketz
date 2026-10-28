import { Request, Response } from "express";
import AppError from "../errors/AppError";
import Whatsapp from "../models/Whatsapp";
import { SalesAiConfig } from "../models/SalesAi";
import { GetCompanySetting } from "../helpers/CheckSettings";
import { provedoresDaEmpresa } from "../services/AiBotServices/AiBotProvidersService";
import {
  chaveDoAmbiente,
  ligarValNaConversa
} from "../services/SalesAiServices/SalesAiService";
import { quemRespondeNoNumero } from "../services/TagServices/funnelActionRules";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import { websocketUpdateTicket } from "../services/TicketServices/UpdateTicketService";

/**
 * Tela "Bots": os bots da empresa num lugar só. Para cada número, qual bot
 * responde. A Val Vendas só aparece onde existe configuração dela.
 */
export const visao = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const [conexoes, chave, modelos, cfg] = await Promise.all([
    Whatsapp.findAll({
      where: { companyId },
      attributes: ["id", "name", "status", "channel"],
      order: [["id", "ASC"]]
    }),
    GetCompanySetting(companyId, "aiBotEnabled", ""),
    provedoresDaEmpresa(companyId),
    SalesAiConfig.findOne({ where: { companyId } })
  ]);

  const atendimento = {
    ligado: chave === "enabled",
    temModelo: modelos.length > 0
  };
  const numerosDaValVendas = cfg && Array.isArray(cfg.whatsappIds) ? cfg.whatsappIds.map(Number) : [];
  const valVendas = cfg
    ? {
        ligada: !!cfg.enabled && chaveDoAmbiente(),
        chaveDoPainel: !!cfg.enabled,
        chaveDoAmbiente: chaveDoAmbiente(),
        conexoes: numerosDaValVendas
      }
    : null;

  return res.json({
    atendimento,
    valVendas,
    conexoes: conexoes.map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
      channel: w.channel,
      ...quemRespondeNoNumero(w.id, {
        numerosDaValVendas,
        valVendasLigada: !!valVendas?.ligada,
        atendimentoLigado: atendimento.ligado,
        atendimentoTemModelo: atendimento.temModelo
      })
    }))
  });
};

/** Botão do card num número da Val Vendas: pausa ou retoma a Val Vendas na conversa. */
export const valNaConversa = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, id: userId } = req.user;
  const { ligado } = req.body as { ligado?: boolean };
  if (typeof ligado !== "boolean") throw new AppError("ERR_AI_BOT_STATE_INVALID", 400);

  const ticket = await ShowTicketService(Number.parseInt(req.params.ticketId, 10), companyId);
  if (!(await ligarValNaConversa(ticket, ligado, `card:${userId}`))) {
    throw new AppError("Esta conversa não está num número da Val Vendas.", 400);
  }
  await ticket.reload();
  websocketUpdateTicket(ticket);
  return res.json({ aiPausedUntil: ticket.aiPausedUntil ?? null });
};
