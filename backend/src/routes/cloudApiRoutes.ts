import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import * as CloudApiController from "../controllers/CloudApiController";
import * as Marketing from "../controllers/CloudApiMarketingController";

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

// Modelos de mensagem: ver é de todos (o atendente escolhe um para responder
// fora das 24h); criar e apagar é de administrador, porque mexe na conta da
// Meta.
cloudApiRoutes.get("/meta/templates", isAuth, Marketing.templates);
cloudApiRoutes.post("/meta/templates", isAuth, isAdmin, Marketing.createTemplate);
cloudApiRoutes.delete(
  "/meta/templates/:name",
  isAuth,
  isAdmin,
  Marketing.removeTemplate
);
cloudApiRoutes.post(
  "/meta/templates/send/:ticketId",
  isAuth,
  Marketing.sendTemplateOnTicket
);

// Disparo em massa: só administrador.
cloudApiRoutes.get("/meta/broadcasts", isAuth, isAdmin, Marketing.broadcasts);
cloudApiRoutes.post(
  "/meta/broadcasts/preview",
  isAuth,
  isAdmin,
  Marketing.previewRecipients
);
cloudApiRoutes.post("/meta/broadcasts", isAuth, isAdmin, Marketing.createBroadcast);
cloudApiRoutes.get("/meta/broadcasts/:id", isAuth, isAdmin, Marketing.broadcast);
cloudApiRoutes.post(
  "/meta/broadcasts/:id/cancel",
  isAuth,
  isAdmin,
  Marketing.cancelBroadcast
);

export default cloudApiRoutes;
