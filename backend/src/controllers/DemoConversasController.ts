import { Request, Response } from "express";
import { randomUUID } from "crypto";
import AppError from "../errors/AppError";
import Contact from "../models/Contact";
import ContactCustomField from "../models/ContactCustomField";
import Message from "../models/Message";
import Tag from "../models/Tag";
import Ticket from "../models/Ticket";
import TicketTag from "../models/TicketTag";
import Whatsapp from "../models/Whatsapp";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketServiceMeta from "../services/TicketServices/FindOrCreateTicketServiceMeta";
import { logger } from "../utils/logger";

/**
 * Conversas de demonstração (Valora): grava contatos, cards e mensagens com
 * data no passado, sem mandar nada para WhatsApp nenhum. Usado pelo Smart para
 * montar o ambiente demo do Elo Eventos. Só o admin da empresa, e o "limpar"
 * exige confirmação explícita porque apaga TODAS as conversas da empresa.
 */

interface MensagemDemo {
  fromMe: boolean;
  body: string;
  /** Quantos minutos atrás a mensagem foi enviada. */
  minutosAtras: number;
}

interface ConversaDemo {
  nome: string;
  numero: string;
  /** Nome da lista do funil (kanban). */
  lista?: string;
  campos?: Record<string, string>;
  mensagens: MensagemDemo[];
  naoLidas?: number;
  status?: "open" | "pending" | "closed";
  botLigado?: boolean | null;
}

const CANAL = "webchat";
const norm = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** "Conexão" da demonstração: uma linha de canal webchat, para o card existir sem número real. */
async function conexaoDaDemo(companyId: number): Promise<number> {
  const existente = await Whatsapp.findOne({ where: { companyId, channel: CANAL } });
  if (existente) return existente.id;
  const criada = await Whatsapp.create({
    name: "Chat do Site",
    companyId,
    channel: CANAL,
    status: "CONNECTED",
    isDefault: false
  } as any);
  return criada.id;
}

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId, profile } = req.user;
  if (profile !== "admin") throw new AppError("ERR_NO_PERMISSION", 403);
  const { limpar, confirmar, conversas } = req.body as {
    limpar?: boolean;
    confirmar?: string;
    conversas?: ConversaDemo[];
  };
  if (!Array.isArray(conversas)) throw new AppError("conversas é obrigatório", 400);

  if (limpar) {
    if (confirmar !== "APAGAR CONVERSAS") throw new AppError("limpar exige confirmar='APAGAR CONVERSAS'", 400);
    const tickets = await Ticket.findAll({ where: { companyId }, attributes: ["id"] });
    const ids = tickets.map(t => t.id);
    if (ids.length) {
      await Message.destroy({ where: { ticketId: ids } });
      await TicketTag.destroy({ where: { ticketId: ids } });
      await Ticket.destroy({ where: { id: ids } });
    }
    const contatos = await Contact.findAll({ where: { companyId }, attributes: ["id"] });
    const cids = contatos.map(c => c.id);
    if (cids.length) {
      await ContactCustomField.destroy({ where: { contactId: cids } });
      await Contact.destroy({ where: { id: cids } });
    }
    logger.info(`[demo] empresa ${companyId}: ${ids.length} conversas e ${cids.length} contatos apagados`);
  }

  const conexaoId = await conexaoDaDemo(companyId);
  const listas = await Tag.findAll({ where: { companyId, kanban: 1 } });
  const agora = Date.now();
  const criados: Array<{ numero: string; ticketId: number; contactId: number }> = [];

  for (const c of conversas) {
    // eslint-disable-next-line no-await-in-loop
    const contato = await CreateOrUpdateContactService({
      name: c.nome,
      number: c.numero,
      isGroup: false,
      companyId,
      channel: CANAL
    } as any);
    // eslint-disable-next-line no-await-in-loop
    const ticket = await FindOrCreateTicketServiceMeta(contato, conexaoId, 0, companyId, CANAL);

    const msgs = [...(c.mensagens || [])].sort((a, b) => b.minutosAtras - a.minutosAtras);
    let ultimaEntrada: Date | null = null;
    let ultima: { body: string; fromMe: boolean; em: Date } | null = null;
    for (const m of msgs) {
      const em = new Date(agora - m.minutosAtras * 60_000);
      // eslint-disable-next-line no-await-in-loop
      await Message.create(
        {
          id: randomUUID(),
          ticketId: ticket.id,
          contactId: contato.id,
          companyId,
          body: m.body,
          fromMe: !!m.fromMe,
          read: true,
          ack: m.fromMe ? 3 : 0,
          channel: CANAL,
          mediaType: "chat",
          remoteJid: c.numero,
          dataJson: "{}",
          createdAt: em,
          updatedAt: em
        } as any,
        { silent: true } as any
      );
      if (!m.fromMe) ultimaEntrada = em;
      ultima = { body: m.body, fromMe: !!m.fromMe, em };
    }

    await Ticket.update(
      {
        status: c.status ?? "open",
        lastMessage: ultima?.body ?? "",
        unreadMessages: c.naoLidas ?? (ultima && !ultima.fromMe ? 1 : 0),
        lastMessageFromMe: ultima?.fromMe ?? null,
        lastInboundAt: ultimaEntrada,
        lastClientMessageAt: ultimaEntrada,
        aiBotEnabled: c.botLigado === undefined ? null : c.botLigado,
        updatedAt: ultima?.em ?? new Date()
      } as any,
      { where: { id: ticket.id }, silent: true } as any
    );

    for (const [name, value] of Object.entries(c.campos || {})) {
      // eslint-disable-next-line no-await-in-loop
      const campo = await ContactCustomField.findOne({ where: { contactId: contato.id, name } });
      // eslint-disable-next-line no-await-in-loop
      if (campo) await campo.update({ value });
      else await ContactCustomField.create({ contactId: contato.id, name, value });
    }

    if (c.lista) {
      const alvo = listas.find(t => norm(t.name) === norm(c.lista as string));
      if (alvo) {
        // eslint-disable-next-line no-await-in-loop
        await TicketTag.destroy({ where: { ticketId: ticket.id, tagId: listas.map(t => t.id) } });
        // eslint-disable-next-line no-await-in-loop
        await TicketTag.create({ ticketId: ticket.id, tagId: alvo.id });
      }
    }
    criados.push({ numero: c.numero, ticketId: ticket.id, contactId: contato.id });
  }

  logger.info(`[demo] empresa ${companyId}: ${criados.length} conversas gravadas`);
  return res.status(201).json({ conversas: criados.length, tickets: criados });
};
