jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../../models/AiUsageLog", () => ({ __esModule: true, default: { count: jest.fn() } }));
jest.mock("../../../helpers/aiBot", () => ({ __esModule: true, chamarProvedor: jest.fn() }));
jest.mock("../../AiUsageServices/RegistrarUsoDaIa", () => ({ __esModule: true, registrarUsoDaIa: jest.fn() }));
jest.mock("../AiBotProvidersService", () => ({ __esModule: true, provedoresDaEmpresa: jest.fn() }));

import AiUsageLog from "../../../models/AiUsageLog";
import { chamarProvedor } from "../../../helpers/aiBot";
import { registrarUsoDaIa } from "../../AiUsageServices/RegistrarUsoDaIa";
import { provedoresDaEmpresa } from "../AiBotProvidersService";
import { gerarTexto, ORIGEM_CONFIGURACAO } from "../GerarTextoService";

const gemini = { provider: "gemini", model: "gemini-2.5-flash-lite", apiKey: "k1", dona: "valora" };
const haiku = { provider: "anthropic", model: "claude-haiku-4-5", apiKey: "k2", dona: "valora" };
const pedido = { sistema: "Monte o bot.", mensagem: "Escola de inglês no Méier." };

describe("Gerar texto com os modelos da empresa (montagem do bot, 14/11/2026)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AiUsageLog.count as jest.Mock).mockResolvedValue(0);
    (provedoresDaEmpresa as jest.Mock).mockResolvedValue([gemini, haiku]);
  });

  it("usa o primeiro modelo, com resposta longa e prazo, e registra o consumo como configuração", async () => {
    (chamarProvedor as jest.Mock).mockResolvedValueOnce('{"persona":"..."}');
    const r = await gerarTexto(7, pedido);
    expect(r).toEqual({ texto: '{"persona":"..."}', provider: "gemini", model: "gemini-2.5-flash-lite" });
    const [provedor, sistema, turnos, , opcoes] = (chamarProvedor as jest.Mock).mock.calls[0];
    expect(provedor).toBe(gemini);
    expect(sistema).toBe("Monte o bot.");
    expect(turnos).toEqual([{ role: "user", text: "Escola de inglês no Méier." }]);
    expect(opcoes.maxTokens).toBe(4000);
    expect(opcoes.timeoutMs).toBeGreaterThan(40_000);
    expect(opcoes.timeoutMs).toBeLessThanOrEqual(45_000);
    expect(registrarUsoDaIa).toHaveBeenCalledWith({ companyId: 7, origem: ORIGEM_CONFIGURACAO }, gemini, expect.objectContaining({ inputTokens: 0 }));
  });

  it("modelo que falha passa ao próximo e a falha também é registrada", async () => {
    const erro = Object.assign(new Error("429"), { response: { status: 429 } });
    (chamarProvedor as jest.Mock).mockRejectedValueOnce(erro).mockResolvedValueOnce("ok");
    const r = await gerarTexto(7, pedido);
    expect(r.provider).toBe("anthropic");
    expect(registrarUsoDaIa).toHaveBeenCalledWith({ companyId: 7, origem: ORIGEM_CONFIGURACAO }, gemini, expect.anything(), erro);
  });

  it("resposta vazia de todos os modelos vira erro claro (502)", async () => {
    (chamarProvedor as jest.Mock).mockResolvedValue("   ");
    await expect(gerarTexto(7, pedido)).rejects.toMatchObject({ statusCode: 502 });
    expect(chamarProvedor).toHaveBeenCalledTimes(2);
  });

  it("teto de 24 h: não chama modelo nenhum (a chave pode ser da Valora)", async () => {
    (AiUsageLog.count as jest.Mock).mockResolvedValue(30);
    await expect(gerarTexto(7, pedido)).rejects.toMatchObject({ statusCode: 429 });
    expect(chamarProvedor).not.toHaveBeenCalled();
    const where = (AiUsageLog.count as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: 7, origem: ORIGEM_CONFIGURACAO });
  });

  it("pedido vazio ou grande demais é recusado antes de gastar", async () => {
    await expect(gerarTexto(7, { sistema: "", mensagem: "x" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(gerarTexto(7, { sistema: "s", mensagem: "x".repeat(40_001) })).rejects.toMatchObject({ statusCode: 400 });
    expect(chamarProvedor).not.toHaveBeenCalled();
  });

  it("conta sem modelo nenhum (nem os da Valora): 503", async () => {
    (provedoresDaEmpresa as jest.Mock).mockResolvedValue([]);
    await expect(gerarTexto(7, pedido)).rejects.toMatchObject({ statusCode: 503 });
  });
});
