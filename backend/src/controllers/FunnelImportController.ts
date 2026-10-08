import { Request, Response } from "express";
import { importarParaLista } from "../services/FunnelImportServices/ImportarParaListaService";

/** Importação em lote de contatos para uma lista do Funil. */
export const importar = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  return res.json(await importarParaLista(companyId, req.body || {}));
};
