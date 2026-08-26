import * as Yup from "yup";
import { Request, Response } from "express";
import AppError from "../errors/AppError";
import TicketNote from "../models/TicketNote";

import ListTicketNotesService from "../services/TicketNoteService/ListTicketNotesService";
import CreateTicketNoteService from "../services/TicketNoteService/CreateTicketNoteService";
import assertNoteInCompany from "../services/TicketNoteService/assertNoteInCompany";
import UpdateTicketNoteService from "../services/TicketNoteService/UpdateTicketNoteService";
import ShowTicketNoteService from "../services/TicketNoteService/ShowTicketNoteService";
import FindAllTicketNotesService from "../services/TicketNoteService/FindAllTicketNotesService";
import DeleteTicketNoteService from "../services/TicketNoteService/DeleteTicketNoteService";
import FindNotesByContactIdAndTicketId from "../services/TicketNoteService/FindNotesByContactIdAndTicketId";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type StoreTicketNoteData = {
  note: string;
  userId: number;
  contactId: number | 0;
  ticketId: number | 0;
  id?: number | string;
};

type UpdateTicketNoteData = {
  note: string;
  id?: number | string;
  userId?: number | 0;
  contactId?: number | 0;
  ticketId?: number | 0;
};

type QueryFilteredNotes = {
  contactId: number | string;
  ticketId: number | string;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { ticketNotes, count, hasMore } = await ListTicketNotesService({
    companyId,
    searchParam,
    pageNumber
  });

  return res.json({ ticketNotes, count, hasMore });
};

export const list = async (req: Request, res: Response): Promise<Response> => {
  const ticketNotes: TicketNote[] = await FindAllTicketNotesService();

  return res.status(200).json(ticketNotes);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const newTicketNote: StoreTicketNoteData = req.body;
  const { id: userId, companyId } = req.user;

  const schema = Yup.object().shape({
    note: Yup.string().required()
  });

  try {
    await schema.validate(newTicketNote);
  } catch (err) {
    throw new AppError(err.message);
  }

  const ticketNote = await CreateTicketNoteService({
    ...newTicketNote,
    userId: Number.parseInt(userId, 10),
    companyId
  });

  return res.status(200).json(ticketNote);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await assertNoteInCompany(id, companyId);
  const ticketNote = await ShowTicketNoteService(id);

  return res.status(200).json(ticketNote);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const ticketNote: UpdateTicketNoteData = req.body;
  const { id } = req.params;
  const { companyId } = req.user;

  const schema = Yup.object().shape({
    note: Yup.string()
  });

  try {
    await schema.validate(ticketNote);
  } catch (err) {
    throw new AppError(err.message);
  }

  await assertNoteInCompany(id, companyId);
  // O id vem da ROTA, nunca do corpo: aceitar o do corpo permitiria passar a
  // checagem com um id e editar outro.
  const recordUpdated = await UpdateTicketNoteService({ ...ticketNote, id });

  return res.status(200).json(recordUpdated);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  if (req.user.profile !== "admin") {
    throw new AppError("ERR_NO_PERMISSION", 403);
  }

  await assertNoteInCompany(id, companyId);
  await DeleteTicketNoteService(id);

  return res.status(200).json({ message: "Observação removida" });
};

export const findFilteredList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  try {
    const { contactId, ticketId } = req.query as QueryFilteredNotes;
    const { companyId } = req.user;
    const notes: TicketNote[] = await FindNotesByContactIdAndTicketId({
      contactId,
      ticketId,
      companyId
    });

    return res.status(200).json(notes);
  } catch (e) {
    return res.status(500).json({ message: e });
  }
};
