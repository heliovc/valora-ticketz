import { Router } from "express";
import * as ValoraIaController from "../controllers/ValoraIaController";

/** Consumo das IAs para o admin da Valora. Segredo interno, ver o controller. */
const valoraIaRoutes = Router();

valoraIaRoutes.get("/valora-internal/ia/consumo", ValoraIaController.consumo);
valoraIaRoutes.get("/valora-internal/ia/chaves", ValoraIaController.chaves);

export default valoraIaRoutes;
