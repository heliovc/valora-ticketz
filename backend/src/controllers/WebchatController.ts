import { Request, Response } from "express";

import * as WebchatService from "../services/WebchatServices/WebchatService";

/**
 * Controller público do Webchat (Chat Widget do Site). Sem autenticação — a
 * empresa é resolvida pela widget key. Chamado pela API Valora (proxy
 * /api/widget/*), que por sua vez é chamada pelo widget.js embutido no site.
 */

// GET /webchat/config?widgetKey=...
export const config = async (req: Request, res: Response): Promise<Response> => {
  const widgetKey = String(req.query.widgetKey || "");
  const companyId = await WebchatService.resolveCompanyByKey(widgetKey);
  if (!companyId) return res.status(404).json({ error: "widget_not_found" });
  const cfg = await WebchatService.getWidgetConfig(companyId);
  return res.status(200).json(cfg);
};

/** Origem do site de terceiro, encaminhada pelo proxy Valora (F4). */
function widgetOrigin(req: Request): string | undefined {
  const o = req.headers["x-widget-origin"] || req.headers["x-widget-referer"];
  return o ? String(o) : undefined;
}

// POST /webchat/session { widgetKey }
export const session = async (req: Request, res: Response): Promise<Response> => {
  const { widgetKey } = req.body || {};
  const companyId = await WebchatService.resolveCompanyByKey(String(widgetKey || ""));
  if (!companyId) return res.status(404).json({ error: "widget_not_found" });
  if (!(await WebchatService.isOriginAllowed(companyId, widgetOrigin(req)))) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  const cfg = await WebchatService.getWidgetConfig(companyId);
  if (!cfg.enabled) return res.status(403).json({ error: "widget_disabled" });
  return res.status(200).json({ sessionId: WebchatService.createSession(), config: cfg });
};

// POST /webchat/message { widgetKey, sessionId, text }
export const message = async (req: Request, res: Response): Promise<Response> => {
  const { widgetKey, sessionId, text } = req.body || {};
  const companyId = await WebchatService.resolveCompanyByKey(String(widgetKey || ""));
  if (!companyId) return res.status(404).json({ error: "widget_not_found" });
  if (!(await WebchatService.isOriginAllowed(companyId, widgetOrigin(req)))) {
    return res.status(403).json({ error: "origin_not_allowed" });
  }
  if (!sessionId || !String(text || "").trim()) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const cfg = await WebchatService.getWidgetConfig(companyId);
  if (!cfg.enabled) return res.status(403).json({ error: "widget_disabled" });
  const result = await WebchatService.handleVisitorMessage(
    companyId,
    String(sessionId),
    String(text)
  );
  return res.status(200).json(result);
};

// GET /webchat/messages?widgetKey=...&sessionId=...&after=ISO
export const messages = async (req: Request, res: Response): Promise<Response> => {
  const widgetKey = String(req.query.widgetKey || "");
  const sessionId = String(req.query.sessionId || "");
  const after = req.query.after ? String(req.query.after) : undefined;
  const companyId = await WebchatService.resolveCompanyByKey(widgetKey);
  if (!companyId) return res.status(404).json({ error: "widget_not_found" });
  if (!sessionId) return res.status(400).json({ error: "invalid_request" });
  const result = await WebchatService.pollMessages(companyId, sessionId, after);
  return res.status(200).json(result);
};
