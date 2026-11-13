jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock("axios", () => ({ __esModule: true, default: { post: jest.fn() } }));
const cache = new Map<string, string>();
jest.mock("../../../libs/cache", () => ({ __esModule: true, cacheLayer: { get: jest.fn(async (k: string) => cache.get(k) ?? null), set: jest.fn(async (k: string, v: string) => { cache.set(k, v); }) } }));
jest.mock("../../../models/Company", () => ({ __esModule: true, default: { findByPk: jest.fn().mockResolvedValue({ id: 2, externalId: "tenant-valora" }) } }));
jest.mock("../../../models/Contact", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/SalesAi", () => ({ __esModule: true, SalesAiConfig: class {} }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../TagServices/notificarValora", () => ({ __esModule: true, notificarValoraPorEmail: jest.fn().mockResolvedValue(true) }));

import axios from "axios";
import { notificarValoraPorEmail } from "../../TagServices/notificarValora";
import { enviarMaterialPorEmail, seguePorEmail } from "../MaterialPorEmail";
import { extrairMarcadoresDeVendas, materialPorEmailDoProduto, mesclarAjustesDeProdutos } from "../salesAiRules";

// Caso real (13/11/2026): Tropical Festas passou "festastropicalfestas @gmail.com" e a Val seguiu insistindo na demo.
const ticket = { id: 2964, companyId: 2, salesSource: "elo_eventos" } as any;
const produtos = {
  elo_eventos: { apresentacaoUrl: "https://valorasolucoes.com/assets/docs/valora-elo-eventos-apresentacao.pdf", apresentacaoNome: "Valora Elo Eventos - Apresentação.pdf" },
  valora_saude: { tabelaUrl: "https://smartpay.example/api/saude/publico/tabela.pdf?chave=x", tabelaNome: "Valora Saúde - tabela de taxas.pdf" }
};
const cfg = { produtos } as any;

describe("marcador [[EMAIL=...]]", () => {
  it("lê o e-mail como o lead digitou (com espaço), limpa e tira da mensagem", () => {
    const m = extrairMarcadoresDeVendas("Combinado! Te mando a apresentação agora. [[EMAIL=festastropicalfestas @gmail.com]] [[RESUMO=x]]");
    expect(m.email).toBe("festastropicalfestas@gmail.com");
    expect(m.texto).toBe("Combinado! Te mando a apresentação agora.");
  });
  it("e-mail inválido não vira envio", () => {
    expect(extrairMarcadoresDeVendas("ok [[EMAIL=não sei]]").email).toBeNull();
    expect(extrairMarcadoresDeVendas("sem marcador").email).toBeNull();
  });
  it("material: a apresentação vence a tabela; sem apresentação, a tabela; sem nada, nulo", () => {
    expect(materialPorEmailDoProduto(produtos, "elo_eventos")?.nome).toBe("Valora Elo Eventos - Apresentação.pdf");
    expect(materialPorEmailDoProduto(produtos, "valora_saude")?.nome).toBe("Valora Saúde - tabela de taxas.pdf");
    expect(materialPorEmailDoProduto({}, "elo_eventos")).toBeNull();
  });
  it("o painel aceita a apresentação por produto e recusa endereço sem https", () => {
    expect(mesclarAjustesDeProdutos({}, { elo_eventos: { apresentacaoUrl: "https://a.b/c.pdf" } })).toEqual({ elo_eventos: { apresentacaoUrl: "https://a.b/c.pdf" } });
    expect(() => mesclarAjustesDeProdutos({}, { elo_eventos: { apresentacaoUrl: "http://a.b/c.pdf" } })).toThrow(/https/);
  });
});

describe("apresentação por e-mail", () => {
  const contato = () => ({ id: 9, name: "Tropical Festas & Eventos", number: "5521972976669", email: "", update: jest.fn().mockResolvedValue(undefined) }) as any;
  beforeEach(() => {
    jest.clearAllMocks();
    cache.clear();
    process.env.VALORA_INTERNAL_URL = "http://smartinter-api:3001/api";
    process.env.VALORA_INTERNAL_SECRET = "s3gredo";
    (axios.post as jest.Mock).mockResolvedValue({ data: { ok: true } });
  });

  it("pede à Valora o e-mail com a apresentação, grava o e-mail no contato e para os lembretes", async () => {
    const c = contato();
    expect(await enviarMaterialPorEmail(ticket, c, cfg, "festastropicalfestas@gmail.com")).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      "http://smartinter-api:3001/api/internal/crm/material-por-email",
      expect.objectContaining({ tenantId: "tenant-valora", ticketId: 2964, email: "festastropicalfestas@gmail.com", produto: "elo_eventos", pdfUrl: produtos.elo_eventos.apresentacaoUrl }),
      expect.objectContaining({ headers: { "x-internal-secret": "s3gredo" } })
    );
    expect(c.update).toHaveBeenCalledWith({ email: "festastropicalfestas@gmail.com" });
    expect(await seguePorEmail(2964)).toBe(true);
  });

  it("uma vez por conversa", async () => {
    await enviarMaterialPorEmail(ticket, contato(), cfg, "a@b.com");
    expect(await enviarMaterialPorEmail(ticket, contato(), cfg, "a@b.com")).toBe(false);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it("envio falhou: avisa o Hélio para mandar à mão", async () => {
    (axios.post as jest.Mock).mockRejectedValue(new Error("502"));
    expect(await enviarMaterialPorEmail(ticket, contato(), cfg, "a@b.com")).toBe(false);
    expect(notificarValoraPorEmail).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 2964, observacao: expect.stringContaining("a@b.com") }));
  });

  it("produto sem material: não chama a Valora, avisa o Hélio", async () => {
    expect(await enviarMaterialPorEmail(ticket, contato(), { produtos: {} } as any, "a@b.com")).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
    expect(notificarValoraPorEmail).toHaveBeenCalledWith(expect.objectContaining({ observacao: expect.stringContaining("não tem apresentação") }));
  });
});
