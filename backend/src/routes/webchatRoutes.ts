import { Router } from "express";

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

export default webchatRoutes;
