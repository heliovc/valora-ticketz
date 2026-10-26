import express from "express";
import isAuth from "../middleware/isAuth";
import isAdmin from "../middleware/isAdmin";
import * as SalesAiController from "../controllers/SalesAiController";

/** Painel da Val Vendas (admin da empresa). Ver SalesAiController. */
const salesAiRoutes = express.Router();

salesAiRoutes.get("/sales-ai/config", isAuth, isAdmin, SalesAiController.showConfig);
salesAiRoutes.put("/sales-ai/config", isAuth, isAdmin, SalesAiController.updateConfig);
salesAiRoutes.get("/sales-ai/connections", isAuth, isAdmin, SalesAiController.listConnections);
salesAiRoutes.get("/sales-ai/refs", isAuth, isAdmin, SalesAiController.listRefs);
salesAiRoutes.post("/sales-ai/refs", isAuth, isAdmin, SalesAiController.saveRef);
salesAiRoutes.put("/sales-ai/refs/:id", isAuth, isAdmin, SalesAiController.saveRef);
salesAiRoutes.delete("/sales-ai/refs/:id", isAuth, isAdmin, SalesAiController.deleteRef);
salesAiRoutes.get("/sales-ai/personal", isAuth, isAdmin, SalesAiController.listPersonal);
salesAiRoutes.put("/sales-ai/personal/:contactId", isAuth, isAdmin, SalesAiController.setPersonal);
salesAiRoutes.post("/sales-ai/personal/bulk", isAuth, isAdmin, SalesAiController.bulkPersonal);
salesAiRoutes.get("/sales-ai/personal/suggestions", isAuth, isAdmin, SalesAiController.personalSuggestions);
salesAiRoutes.post("/sales-ai/personal/suggestions/apply", isAuth, isAdmin, SalesAiController.applyPersonalSuggestions);
salesAiRoutes.get("/sales-ai/campaign-lists", isAuth, isAdmin, SalesAiController.listCampaignLists);
salesAiRoutes.post("/sales-ai/campaign-lists/import", isAuth, isAdmin, SalesAiController.importCampaignList);
salesAiRoutes.post("/sales-ai/campaign-lists/from-tags", isAuth, isAdmin, SalesAiController.importFromTags);
salesAiRoutes.get("/sales-ai/playbook", isAuth, isAdmin, SalesAiController.listPlaybook);
salesAiRoutes.post("/sales-ai/playbook", isAuth, isAdmin, SalesAiController.savePlaybook);
salesAiRoutes.post("/sales-ai/playbook/:id/activate", isAuth, isAdmin, SalesAiController.activatePlaybook);
salesAiRoutes.get("/sales-ai/decisions", isAuth, isAdmin, SalesAiController.listDecisions);
salesAiRoutes.post("/sales-ai/tickets/:ticketId/command", isAuth, SalesAiController.ticketCommand);
salesAiRoutes.get("/sales-ai/dashboard", isAuth, isAdmin, SalesAiController.dashboard);
salesAiRoutes.get("/sales-ai/automations", isAuth, isAdmin, SalesAiController.automations);

export default salesAiRoutes;
