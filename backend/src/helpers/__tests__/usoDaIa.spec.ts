jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../../services/AiUsageServices/RegistrarUsoDaIa", () => ({ __esModule: true, registrarUsoDaIa: jest.fn(async () => undefined) }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { generateBotReply } from "../aiBot";
import { classificarFalhaDaIa, digitalDaChave, lerUso, novoMedidor, precoAnthropic } from "../usoDaIa";
import { registrarUsoDaIa } from "../../services/AiUsageServices/RegistrarUsoDaIa";

describe("leitura do consumo de cada provedor (11/11/2026)", () => {
  it("OpenRouter: tokens e o custo que ele informa", () => {
    expect(lerUso("openrouter", { usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00042 } })).toEqual({
      inputTokens: 1200,
      outputTokens: 80,
      costUsd: 0.00042
    });
  });

  it("Groq: tokens sem custo", () => {
    expect(lerUso("groq", { usage: { prompt_tokens: 10, completion_tokens: 5 } })).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: null });
  });

  it("Gemini: tokens do usageMetadata, pensamento conta como saída", () => {
    expect(lerUso("gemini", { usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40, thoughtsTokenCount: 10 } })).toEqual({
      inputTokens: 300,
      outputTokens: 50,
      costUsd: null
    });
  });

  it("Anthropic: custo estimado pela tabela, com cache lido a 0,1x e gravado a 1,25x", () => {
    const r = lerUso(
      "anthropic",
      { usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000 } },
      "claude-haiku-4-5"
    );
    expect(r.inputTokens).toBe(13000);
    expect(r.outputTokens).toBe(200);
    // (1000*1 + 10000*0,1 + 2000*1,25 + 200*5) / 1e6
    expect(r.costUsd).toBeCloseTo(0.0055, 8);
    expect(precoAnthropic("claude-opus-5-5")).toEqual({ entrada: 4, saida: 20 });
    expect(precoAnthropic("claude-haiku-5-5")).toEqual({ entrada: 0.1, saida: 0.5 });
    expect(lerUso("anthropic", { usage: { input_tokens: 5 } }, "modelo-desconhecido").costUsd).toBeNull();
  });

  it("resposta sem uso não quebra", () => {
    expect(lerUso("openrouter", {})).toEqual({ inputTokens: 0, outputTokens: 0, costUsd: null });
  });

  it("medidor soma as rodadas e mantém custo nulo enquanto ninguém informa", () => {
    const m = novoMedidor();
    m.somar({ inputTokens: 10, outputTokens: 2, costUsd: null });
    expect(m.total().costUsd).toBeNull();
    m.somar({ inputTokens: 5, outputTokens: 1, costUsd: 0.01 });
    m.somar({ inputTokens: 1, outputTokens: 1, costUsd: 0.02 });
    expect(m.total()).toEqual({ inputTokens: 16, outputTokens: 4, costUsd: 0.03 });
  });

  it("classifica a falha: crédito, cota, chave, tempo", () => {
    expect(classificarFalhaDaIa({ response: { status: 402, data: {} } })).toBe("sem_credito");
    expect(classificarFalhaDaIa({ response: { status: 400, data: { error: { message: "Your credit balance is too low" } } } })).toBe("sem_credito");
    expect(classificarFalhaDaIa({ response: { status: 429, data: { error: { status: "RESOURCE_EXHAUSTED" } } } })).toBe("cota");
    expect(classificarFalhaDaIa({ response: { status: 401, data: {} } })).toBe("chave_invalida");
    expect(classificarFalhaDaIa({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" })).toBe("tempo");
    expect(classificarFalhaDaIa(new Error("resposta vazia de openrouter"))).toBe("outro");
  });

  it("impressão digital: igual para a mesma chave, nunca a chave", () => {
    expect(digitalDaChave("sk-or-abc")).toBe(digitalDaChave("sk-or-abc"));
    expect(digitalDaChave("sk-or-abc")).not.toBe(digitalDaChave("sk-or-abd"));
    expect(digitalDaChave("sk-or-abc")).toHaveLength(12);
    expect(digitalDaChave("sk-or-abc")).not.toContain("sk-or");
  });
});

describe("generateBotReply grava o consumo de cada modelo tentado", () => {
  beforeEach(() => jest.clearAllMocks());
  const uso = { companyId: 2, ticketId: 99, origem: "val_saude", canal: "oficial" };

  it("primeiro modelo sem crédito, segundo responde: duas linhas, falha classificada", async () => {
    (axios.post as jest.Mock)
      .mockRejectedValueOnce(Object.assign(new Error("402"), { isAxiosError: true, response: { status: 402, data: { error: { message: "Insufficient credits" } } } }))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: "Olá!" } }], usage: { prompt_tokens: 900, completion_tokens: 30, cost: 0.0002 } } });
    const r = await generateBotReply({
      persona: "p",
      history: [],
      userMessage: "oi",
      provedores: [
        { provider: "openrouter", model: "anthropic/claude-haiku-5.5", apiKey: "k1", dona: "valora", final: "aaaa" },
        { provider: "groq", model: "qwen", apiKey: "k2", dona: "empresa", final: "bbbb" }
      ],
      uso
    });
    expect(r?.text).toBe("Olá!");
    const chamadas = (registrarUsoDaIa as jest.Mock).mock.calls;
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0][0]).toEqual(uso);
    expect(chamadas[0][1]).toMatchObject({ provider: "openrouter", dona: "valora", final: "aaaa" });
    expect(chamadas[0][3]).toBeTruthy();
    expect(chamadas[1][1]).toMatchObject({ provider: "groq" });
    expect(chamadas[1][2]).toEqual({ inputTokens: 900, outputTokens: 30, costUsd: null });
    expect(chamadas[1][3]).toBeNull();
  });

  it("OpenRouter recebe o pedido de custo no corpo", async () => {
    (axios.post as jest.Mock).mockResolvedValueOnce({ data: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.1 } } });
    await generateBotReply({ persona: "p", history: [], userMessage: "oi", provedores: [{ provider: "openrouter", model: "m", apiKey: "k" }], uso });
    expect((axios.post as jest.Mock).mock.calls[0][1]).toMatchObject({ usage: { include: true } });
    expect((registrarUsoDaIa as jest.Mock).mock.calls[0][2]).toEqual({ inputTokens: 1, outputTokens: 1, costUsd: 0.1 });
  });
});
