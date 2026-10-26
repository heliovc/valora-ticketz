import express from "express";
import isAuth from "../middleware/isAuth";
import * as DemoConversasController from "../controllers/DemoConversasController";

/** Conversas de demonstração gravadas pela Valora (Elo Eventos). Admin da empresa. */
const demoConversasRoutes = express.Router();

demoConversasRoutes.post("/demo/conversas", isAuth, DemoConversasController.store);
demoConversasRoutes.post("/demo/ia-da-valora", isAuth, DemoConversasController.copiarIa);

export default demoConversasRoutes;
