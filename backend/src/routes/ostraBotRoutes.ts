import { Router } from "express";
import * as OstraBotController from "../controllers/OstraBotController";

/** Mac do Hélio ↔ assistente Ostra Carioca. Token próprio, ver o controller. */
const ostraBotRoutes = Router();

ostraBotRoutes.get("/ostra-bot/pendentes", OstraBotController.pendentes);
ostraBotRoutes.post("/ostra-bot/rascunhos/:id", OstraBotController.entregar);
ostraBotRoutes.get("/ostra-bot/mensagens", OstraBotController.mensagens);
ostraBotRoutes.post("/ostra-bot/avisos", OstraBotController.aviso);

export default ostraBotRoutes;
