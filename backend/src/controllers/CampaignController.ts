import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { head } from "lodash";
import fs from "fs";
import path from "path";

import ListService from "../services/CampaignService/ListService";
import CreateService from "../services/CampaignService/CreateService";
import ShowService from "../services/CampaignService/ShowService";
import UpdateService from "../services/CampaignService/UpdateService";
import DeleteService from "../services/CampaignService/DeleteService";
import FindService from "../services/CampaignService/FindService";

import Campaign from "../models/Campaign";

import AppError from "../errors/AppError";
import ContactList from "../models/ContactList";
import Whatsapp from "../models/Whatsapp";
import { registroDaEmpresa } from "../helpers/registroDaEmpresa";
import { CancelService } from "../services/CampaignService/CancelService";
import { RestartService } from "../services/CampaignService/RestartService";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
  companyId: string | number;
};

type StoreData = {
  name: string;
  status: string;
  confirmation: boolean;
  scheduledAt: Date;
  companyId: number;
  contactListId: number;
};

/**
 * Campos que nunca vêm do corpo: `companyId` sai do token e `id` da rota.
 * Aceitos do corpo, mudavam a campanha de dono.
 */
const semCamposProtegidos = <T extends Record<string, any>>(data: T): T => {
  const { companyId: _c, id: _i, ...resto } = data as any;
  return resto;
};

/** Conexão e lista de contatos precisam ser da mesma empresa da campanha. */
const validarReferencias = async (
  data: Record<string, any>,
  companyId: number
): Promise<void> => {
  if (data.whatsappId) {
    await registroDaEmpresa(Whatsapp, data.whatsappId, companyId, "ERR_NO_WAPP_FOUND");
  }
  if (data.contactListId) {
    await registroDaEmpresa(
      ContactList,
      data.contactListId,
      companyId,
      "ERR_NO_CONTACTLIST_FOUND"
    );
  }
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;
  const { companyId } = req.user;

  const { records, count, hasMore } = await ListService({
    searchParam,
    pageNumber,
    companyId
  });

  return res.json({ records, count, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const data = req.body as StoreData;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  await validarReferencias(data, companyId);

  const record = await CreateService({
    ...semCamposProtegidos(data),
    companyId
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-campaign`, {
    action: "create",
    record
  });

  return res.status(200).json(record);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await registroDaEmpresa(Campaign, id, companyId, "ERR_NO_CAMPAIGN_FOUND");
  const record = await ShowService(id);

  return res.status(200).json(record);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const data = req.body as StoreData;
  const { companyId } = req.user;

  const schema = Yup.object().shape({
    name: Yup.string().required()
  });

  try {
    await schema.validate(data);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const { id } = req.params;

  await registroDaEmpresa(Campaign, id, companyId, "ERR_NO_CAMPAIGN_FOUND");
  await validarReferencias(data, companyId);

  const record = await UpdateService({
    ...semCamposProtegidos(data),
    id: parseInt(id, 10)
  });

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-campaign`, {
    action: "update",
    record
  });

  return res.status(200).json(record);
};

export const cancel = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await registroDaEmpresa(Campaign, id, req.user.companyId, "ERR_NO_CAMPAIGN_FOUND");
  await CancelService(+id);

  return res.status(204).json({ message: "Cancelamento realizado" });
};

export const restart = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  await registroDaEmpresa(Campaign, id, req.user.companyId, "ERR_NO_CAMPAIGN_FOUND");
  await RestartService(+id);

  return res.status(204).json({ message: "Reinício dos disparos" });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const { companyId } = req.user;

  await registroDaEmpresa(Campaign, id, companyId, "ERR_NO_CAMPAIGN_FOUND");
  await DeleteService(id);

  const io = getIO();
  io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-campaign`, {
    action: "delete",
    id
  });

  return res.status(200).json({ message: "Campaign deleted" });
};

export const findList = async (
  req: Request,
  res: Response
): Promise<Response> => {
  // A empresa vem SEMPRE do token: vinda da query, listava a de qualquer um.
  const records: Campaign[] = await FindService({
    companyId: String(req.user.companyId)
  });

  return res.status(200).json(records);
};

export const mediaUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;
  const files = req.files as Express.Multer.File[];
  const file = head(files);

  const campaign = await registroDaEmpresa(
    Campaign,
    id,
    req.user.companyId,
    "ERR_NO_CAMPAIGN_FOUND"
  );
  try {
    campaign.mediaPath = file.filename;
    campaign.mediaName = file.originalname;
    await campaign.save();
    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};

export const deleteMedia = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  const campaign = await registroDaEmpresa(
    Campaign,
    id,
    req.user.companyId,
    "ERR_NO_CAMPAIGN_FOUND"
  );
  try {
    const filePath = path.resolve("public", campaign.mediaPath);
    const fileExists = fs.existsSync(filePath);
    if (fileExists) {
      fs.unlinkSync(filePath);
    }

    campaign.mediaPath = null;
    campaign.mediaName = null;
    await campaign.save();
    return res.send({ mensagem: "Arquivo excluído" });
  } catch (err: any) {
    throw new AppError(err.message);
  }
};
