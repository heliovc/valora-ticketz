import express from "express";
import isAuth from "../middleware/isAuth";
import isCompliant from "../middleware/isCompliant";
import * as BotsController from "../controllers/BotsController";

/** Tela "Bots" do Valora Smart. Ver BotsController. */
const botsRoutes = express.Router();

botsRoutes.get("/bots/visao", isAuth, BotsController.visao);
botsRoutes.put("/bots/tickets/:ticketId/val-vendas", isAuth, isCompliant, BotsController.valNaConversa);

export default botsRoutes;
