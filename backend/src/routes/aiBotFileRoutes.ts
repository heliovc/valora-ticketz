import { Router } from "express";
import multer from "multer";

import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import uploadPrivateConfig from "../config/privateFiles";
import * as AiBotFileController from "../controllers/AiBotFileController";

const aiBotFileRoutes = Router();

// Mesma pasta privada dos outros arquivos internos: o conteúdo é do lojista e
// não pode ficar no diretório servido publicamente.
const upload = multer(uploadPrivateConfig);

// `isAdmin` acompanha a regra da persona: quem configura o bot é quem
// administra o CRM daquela conta, não qualquer atendente convidado.
aiBotFileRoutes.get("/ai-bot-files", isAuth, isAdmin, AiBotFileController.index);

aiBotFileRoutes.post(
  "/ai-bot-files",
  isAuth,
  isAdmin,
  upload.single("file"),
  AiBotFileController.store
);

aiBotFileRoutes.delete(
  "/ai-bot-files/:fileId",
  isAuth,
  isAdmin,
  AiBotFileController.remove
);

export default aiBotFileRoutes;
