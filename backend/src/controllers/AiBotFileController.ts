import { Request, Response } from "express";

import AppError from "../errors/AppError";
import {
  CreateAiBotFileService,
  DeleteAiBotFileService,
  ListAiBotFilesService
} from "../services/AiBotFileServices/AiBotFileService";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const arquivos = await ListAiBotFilesService(companyId);

  return res.status(200).json(arquivos);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const file = req.file as Express.Multer.File;

  if (!file) {
    throw new AppError("Nenhum arquivo enviado.", 400);
  }

  const arquivo = await CreateAiBotFileService({ companyId, file });

  return res.status(200).json({
    id: arquivo.id,
    name: arquivo.name,
    mimetype: arquivo.mimetype,
    size: arquivo.size,
    charCount: arquivo.charCount,
    createdAt: arquivo.createdAt
  });
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const { fileId } = req.params;

  await DeleteAiBotFileService(Number(fileId), companyId);

  return res.status(200).json({ message: "File deleted" });
};
