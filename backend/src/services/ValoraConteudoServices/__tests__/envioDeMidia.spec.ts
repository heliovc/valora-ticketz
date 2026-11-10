import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { lerCorpoDaConsultora } from "../../../controllers/ValoraConteudoController";

jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: class {} }));
jest.mock("../../MessageServices/CreateMessageService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../CloudApiServices/CloudApiChannel", () => ({ __esModule: true, CHANNEL: "whatsapp_official", getToken: () => "t", graphUrl: (p: string) => p, conexaoDoTicket: jest.fn() }));

/**
 * Prévia do post da consultora (10/11/2026): a imagem chegava em base64 com ~1 MB
 * e o `express.json` global (100 KB) devolvia 500. A dona pedia o post e não
 * recebia nada. Mesma ordem de middlewares do app.ts.
 */

const ROTA = "/valora-internal/conteudo/send";
const SEGREDO = "segredo-interno-de-teste-32-chars";

function montarApp(comCorrecao: boolean) {
  const app = express();
  if (comCorrecao) app.use(ROTA, ...lerCorpoDaConsultora);
  app.use(express.json());
  app.post(ROTA, (req: Request, res: Response) => res.json({ tamanho: String(req.body?.media?.base64 || "").length }));
  app.post("/outra-rota", (_req: Request, res: Response) => res.json({ ok: true }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((_err: Error, _req: Request, res: Response, _next: NextFunction) => res.status(500).json({ error: "Internal server error" }));
  return app;
}

/** Tamanho da imagem do post que falhou em produção (726 KB em JPEG ≈ 1 MB em base64). */
const imagem = { ticketId: 472, kind: "image", text: "", media: { base64: "A".repeat(970_000), mimeType: "image/jpeg", filename: "post.jpg" } };

describe("envio de mídia da consultora", () => {
  const antes = process.env.VALORA_INTERNAL_SECRET;
  beforeAll(() => {
    process.env.VALORA_INTERNAL_SECRET = SEGREDO;
  });
  afterAll(() => {
    process.env.VALORA_INTERNAL_SECRET = antes;
  });

  it("sem a correção, a imagem do post dava 500 (o que aconteceu em produção)", async () => {
    const r = await request(montarApp(false)).post(ROTA).set("x-internal-secret", SEGREDO).send(imagem);
    expect(r.status).toBe(500);
  });

  it("com a correção, a imagem de ~1 MB chega inteira à rota", async () => {
    const r = await request(montarApp(true)).post(ROTA).set("x-internal-secret", SEGREDO).send(imagem);
    expect(r.status).toBe(200);
    expect(r.body.tamanho).toBe(970_000);
  });

  it("vídeo de ~13 MB em base64 também passa", async () => {
    const video = { ...imagem, kind: "video", media: { ...imagem.media, base64: "A".repeat(13_000_000), mimeType: "video/mp4" } };
    const r = await request(montarApp(true)).post(ROTA).set("x-internal-secret", SEGREDO).send(video);
    expect(r.status).toBe(200);
    expect(r.body.tamanho).toBe(13_000_000);
  }, 30_000);

  it("sem o segredo, 404 antes de ler o corpo", async () => {
    const r = await request(montarApp(true)).post(ROTA).set("x-internal-secret", "errado").send(imagem);
    expect(r.status).toBe(404);
  });

  it("as outras rotas continuam com o limite de 100 KB", async () => {
    const r = await request(montarApp(true)).post("/outra-rota").send(imagem);
    expect(r.status).toBe(500);
  });
});
