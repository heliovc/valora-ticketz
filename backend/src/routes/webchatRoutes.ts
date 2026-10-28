import { Router } from "express";

import isAuth from "../middleware/isAuth";
import * as WebchatController from "../controllers/WebchatController";

/**
 * Rotas PÚBLICAS do Webchat (Chat Widget do Site) — sem isAuth. A empresa é
 * resolvida pela widget key. Consumidas pela API Valora (proxy /api/widget/*).
 */
const webchatRoutes = Router();

webchatRoutes.get("/webchat/config", WebchatController.config);
webchatRoutes.post("/webchat/session", WebchatController.session);
webchatRoutes.post("/webchat/message", WebchatController.message);
webchatRoutes.get("/webchat/messages", WebchatController.messages);

// Teste do bot pelo painel do dono — AUTENTICADO: a empresa vem do login, não de widget key.
webchatRoutes.post("/webchat/teste/session", isAuth, WebchatController.testeSession);
webchatRoutes.post("/webchat/teste/message", isAuth, WebchatController.testeMessage);
webchatRoutes.get("/webchat/teste/messages", isAuth, WebchatController.testeMessages);

export default webchatRoutes;
