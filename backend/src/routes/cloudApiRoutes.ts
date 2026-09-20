import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import * as CloudApiController from "../controllers/CloudApiController";

/**
 * WhatsApp Oficial (Meta Cloud API).
 *
 * `/meta/webhook` é PÚBLICA por obrigação — quem chama é a Meta, que não tem
 * como se autenticar com o nosso JWT. A proteção dessas duas rotas é a
 * assinatura HMAC do corpo (`X-Hub-Signature-256`) e o `verify_token`, não o
 * middleware. O prefixo `/meta/webhook` também é o que `app.ts` usa para
 * decidir onde guardar o corpo cru.
 *
 * As rotas de conexão são de administrador, como as do Baileys.
 */
const cloudApiRoutes = Router();

cloudApiRoutes.get("/meta/webhook", CloudApiController.verify);
cloudApiRoutes.post("/meta/webhook", CloudApiController.receive);

cloudApiRoutes.get("/meta/connection", isAuth, CloudApiController.show);
cloudApiRoutes.post("/meta/connection", isAuth, isAdmin, CloudApiController.store);
cloudApiRoutes.post(
  "/meta/connection/check",
  isAuth,
  isAdmin,
  CloudApiController.check
);

export default cloudApiRoutes;
