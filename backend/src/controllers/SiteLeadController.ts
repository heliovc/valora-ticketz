import { Request, Response } from "express";
import { randomUUID } from "crypto";
import AppError from "../errors/AppError";
import ContactCustomField from "../models/ContactCustomField";
import Tag from "../models/Tag";
import Ticket from "../models/Ticket";
import TicketTag from "../models/TicketTag";
import Whatsapp from "../models/Whatsapp";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import CreateMessageService from "../services/MessageServices/CreateMessageService";
import FindOrCreateTicketServiceMeta from "../services/TicketServices/FindOrCreateTicketServiceMeta";
import { logger } from "../utils/logger";

/**
 * Lead vindo de um formulário de site (Valora): vira contato + card na
 * "Entrada" da empresa, com a mensagem do formulário como se o cliente tivesse
 * escrito, etiqueta e campos. Não valida o número no WhatsApp (o site não
 * tem sessão) — o card nasce na conexão padrão da empresa, e a resposta sai
 * por ela; sem conexão de WhatsApp, cai no canal webchat.
 */

interface LeadDoSite {
  nome: string;
  /** Só dígitos, com DDI (5521…). */
  numero: string;
  mensagem: string;
  campos?: Record<string, string>;
  etiqueta?: string;
}

const norm = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

async function conexaoParaOLead(companyId: number): Promise<{ id: number; canal: string }> {
  const wa = await Whatsapp.findOne({
    where: { companyId, status: "CONNECTED", channel: "whatsapp" },
    order: [["isDefault", "DESC"], ["id", "ASC"]]
  });
  if (wa) return { id: wa.id, canal: "whatsapp" };
  const web = await Whatsapp.findOne({ where: { companyId, channel: "webchat" } });
  if (web) return { id: web.id, canal: "webchat" };
  const criada = await Whatsapp.create({
    name: "Chat do Site",
    companyId,
    channel: "webchat",
    status: "CONNECTED",
    isDefault: false
  } as any);
  return { id: criada.id, canal: "webchat" };
}

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const lead = req.body as LeadDoSite;
  const numero = String(lead?.numero || "").replace(/\D/g, "");
  if (!lead?.nome?.trim() || numero.length < 10 || !lead?.mensagem?.trim()) {
    throw new AppError("nome, numero (com DDI) e mensagem são obrigatórios", 400);
  }

  const conexao = await conexaoParaOLead(companyId);
  const contato = await CreateOrUpdateContactService({
    name: lead.nome.trim(),
    number: numero,
    isGroup: false,
    companyId,
    channel: conexao.canal
  } as any);
  const ticket = await FindOrCreateTicketServiceMeta(contato, conexao.id, 0, companyId, conexao.canal);

  const msg = await CreateMessageService({
    messageData: {
      id: randomUUID(),
      ticketId: ticket.id,
      contactId: contato.id,
      body: lead.mensagem.trim(),
      fromMe: false,
      read: false,
      channel: conexao.canal
    },
    companyId
  });
  await Ticket.update(
    {
      status: "pending",
      lastMessage: lead.mensagem.trim().slice(0, 255),
      unreadMessages: (ticket.unreadMessages || 0) + 1,
      lastMessageFromMe: false,
      lastInboundAt: new Date(),
      lastClientMessageAt: new Date()
    } as any,
    { where: { id: ticket.id } }
  );

  for (const [name, value] of Object.entries(lead.campos || {})) {
    if (!value) continue;
    // eslint-disable-next-line no-await-in-loop
    const campo = await ContactCustomField.findOne({ where: { contactId: contato.id, name } });
    // eslint-disable-next-line no-await-in-loop
    if (campo) await campo.update({ value: String(value) });
    else await ContactCustomField.create({ contactId: contato.id, name, value: String(value) });
  }

  if (lead.etiqueta) {
    const todas = await Tag.findAll({ where: { companyId } });
    let tag = todas.find(t => norm(t.name) === norm(lead.etiqueta as string) && (t.kanban ?? 0) !== 1);
    if (!tag) tag = await Tag.create({ name: lead.etiqueta, color: "#22c55e", kanban: 0, companyId } as any);
    const ja = await TicketTag.findOne({ where: { ticketId: ticket.id, tagId: tag.id } });
    if (!ja) await TicketTag.create({ ticketId: ticket.id, tagId: tag.id });
  }

  logger.info(`[site-lead] empresa ${companyId}: card ${ticket.id} (${conexao.canal}) para ${numero}`);
  return res.status(201).json({ ticketId: ticket.id, contactId: contato.id, messageId: msg.id, canal: conexao.canal });
};
