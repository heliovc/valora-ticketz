import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import uploadConfig from "../config/upload";

import * as ContactController from "../controllers/ContactController";
import * as ImportPhoneContactsController from "../controllers/ImportPhoneContactsController";
import apiTokenAuth from "../middleware/apiTokenAuth";

const contactRoutes = express.Router();
const upload = multer(uploadConfig);

contactRoutes.post(
  "/contacts/import",
  isAuth,
  isAdmin,
  ImportPhoneContactsController.store
);

contactRoutes.post(
  "/contacts/importCsv",
  isAuth,
  isAdmin,
  upload.single("contacts"),
  ContactController.importCsv
);

contactRoutes.get(
  "/contacts/exportCsv",
  isAuth,
  isAdmin,
  ContactController.exportCsv
);

contactRoutes.get("/contacts", apiTokenAuth, isAuth, ContactController.index);

contactRoutes.get(
  "/contacts/list",
  apiTokenAuth,
  isAuth,
  ContactController.list
);

contactRoutes.get(
  "/contacts/:contactId",
  apiTokenAuth,
  isAuth,
  ContactController.show
);

contactRoutes.post(
  "/contacts/findOrInsert",
  apiTokenAuth,
  isAuth,
  ContactController.findOrInsertContact
);

contactRoutes.post("/contacts", apiTokenAuth, isAuth, ContactController.store);

contactRoutes.put(
  "/contacts/:contactId",
  apiTokenAuth,
  isAuth,
  ContactController.update
);

/**
 * Junta dois cadastros que são a mesma pessoa.
 *
 * Declarada ANTES do delete de `/contacts/:contactId` não por ordem — são verbos
 * diferentes — mas para ficar ao lado do que ela substitui na prática: antes
 * disto, resolver um lead duplicado só dava apagando um dos dois, e com ele iam
 * as mensagens.
 */
contactRoutes.put(
  "/contacts/:contactId/merge",
  apiTokenAuth,
  isAuth,
  ContactController.merge
);

contactRoutes.delete(
  "/contacts/:contactId",
  apiTokenAuth,
  isAuth,
  ContactController.remove
);

contactRoutes.post(
  "/contacts/:contactId/tags",
  apiTokenAuth,
  isAuth,
  ContactController.storeTag
);

contactRoutes.delete(
  "/contacts/:contactId/tags/:tagId",
  apiTokenAuth,
  isAuth,
  ContactController.removeTag
);

export default contactRoutes;
