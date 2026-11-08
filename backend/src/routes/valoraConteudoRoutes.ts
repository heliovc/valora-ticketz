import { Router } from "express";
import * as ValoraConteudoController from "../controllers/ValoraConteudoController";

/** Valora ↔ consultora do Conteúdo IA. Segredo interno, ver o controller. */
const valoraConteudoRoutes = Router();

valoraConteudoRoutes.post("/valora-internal/conteudo/send", ValoraConteudoController.send);
valoraConteudoRoutes.get("/valora-internal/conteudo/conexoes", ValoraConteudoController.conexoes);
valoraConteudoRoutes.put("/valora-internal/conteudo/conexoes/:id", ValoraConteudoController.definirModo);

export default valoraConteudoRoutes;
