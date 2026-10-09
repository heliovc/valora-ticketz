import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import * as AiBotProvidersController from "../controllers/AiBotProvidersController";

/** Modelos de IA do bot (por empresa): só administrador mexe em chave. */
const aiBotProvidersRoutes = Router();

aiBotProvidersRoutes.get("/ai-bot/providers", isAuth, isAdmin, AiBotProvidersController.index);
aiBotProvidersRoutes.put("/ai-bot/providers", isAuth, isAdmin, AiBotProvidersController.update);
aiBotProvidersRoutes.post(
  "/ai-bot/providers/:posicao/test",
  isAuth,
  isAdmin,
  AiBotProvidersController.test
);

aiBotProvidersRoutes.get("/ai-bot/fields", isAuth, isAdmin, AiBotProvidersController.fields);
aiBotProvidersRoutes.put("/ai-bot/fields", isAuth, isAdmin, AiBotProvidersController.updateFields);

export default aiBotProvidersRoutes;
