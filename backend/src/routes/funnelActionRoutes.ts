import express from "express";
import isAuth from "../middleware/isAuth";
import * as FunnelActionController from "../controllers/FunnelActionController";

/**
 * Automações do funil. `:tagId` aceita o id de uma lista ou a palavra
 * `entrada`, que é a automação de conversa nova (sem lista).
 */
const funnelActionRoutes = express.Router();

funnelActionRoutes.get(
  // Antes da rota com `:tagId` — senão "resumo" seria lido como um id de lista.
  "/funnel-actions/resumo",
  isAuth,
  FunnelActionController.resumo
);
funnelActionRoutes.get(
  "/funnel-actions/:tagId",
  isAuth,
  FunnelActionController.index
);
funnelActionRoutes.post(
  "/funnel-actions/:tagId",
  isAuth,
  FunnelActionController.store
);
funnelActionRoutes.put(
  "/funnel-actions/action/:actionId",
  isAuth,
  FunnelActionController.update
);
funnelActionRoutes.delete(
  "/funnel-actions/action/:actionId",
  isAuth,
  FunnelActionController.remove
);

export default funnelActionRoutes;
