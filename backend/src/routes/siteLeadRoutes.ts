import express from "express";
import isAuth from "../middleware/isAuth";
import * as SiteLeadController from "../controllers/SiteLeadController";

/** Lead de formulário de site (Valora) → card na Entrada com etiqueta e campos. */
const siteLeadRoutes = express.Router();

siteLeadRoutes.post("/site/leads", isAuth, SiteLeadController.store);

export default siteLeadRoutes;
