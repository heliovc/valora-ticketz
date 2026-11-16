jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { chamarProvedor, esquecerRecusasDeAjustes, limparMarcacoesDoModelo } from "../aiBot";

/**
 * Demo do Eventos, 16/11/2026: o Claude Haiku pelo OpenRouter respondeu
 * "Prazer, Helio! … festa infantil?" seguido de duas linhas
 * "<reasoning_effort>1</reasoning_effort>", e o cliente viu as duas.
 */
const post = axios.post as jest.Mock;
const ok = (texto: string) => ({ data: { choices: [{ message: { content: texto }, finish_reason: "stop" }] } });
const haiku = { provider: "openrouter" as const, model: "anthropic/claude-haiku-5.5", apiKey: "k" };
const PERGUNTA = "Prazer, Helio! Para começar, qual tipo de festa você está planejando: casamento, 15 anos ou festa infantil?";

describe("marcações internas do modelo nunca vão ao cliente", () => {
  beforeEach(() => {
    post.mockReset();
    esquecerRecusasDeAjustes();
  });

  it("o caso da demo: tira as duas <reasoning_effort> e as linhas em branco que sobram", async () => {
    post.mockResolvedValueOnce(ok(`${PERGUNTA}\n\n<reasoning_effort>1</reasoning_effort>\n\n<reasoning_effort>1</reasoning_effort>`));
    const texto = await chamarProvedor(haiku, "sistema", [{ role: "user", text: "Helio" }]);
    expect(texto).toBe(PERGUNTA);
  });

  it("segue tirando o pensamento entre <think>…</think>", () => {
    expect(limparMarcacoesDoModelo("<think>o lead quer preço</think>\nSai por R$ 2.500.")).toBe("Sai por R$ 2.500.");
  });

  it("tira marcação solta, com atributo ou no meio do texto, sem colar as palavras erradas", () => {
    expect(limparMarcacoesDoModelo("Oi! <thinking_mode>interleaved</thinking_mode>Tudo bem?")).toBe("Oi! Tudo bem?");
    expect(limparMarcacoesDoModelo("Oi!\n</reasoning_effort>\n<effort level=\"low\"/>")).toBe("Oi!");
  });

  it("não mexe em texto normal nem em sinais de menor/maior da conversa", () => {
    const normal = "Para <50 convidados o pacote é o Básico.\n\nPara mais de 100, o Premium. [[GERAR_PROPOSTA]]";
    expect(limparMarcacoesDoModelo(normal)).toBe(normal);
  });

  it("resposta que era só marcação vira vazia (e o fluxo de resposta vazia assume)", async () => {
    post.mockResolvedValue(ok("<reasoning_effort>1</reasoning_effort>"));
    await expect(chamarProvedor(haiku, "sistema", [{ role: "user", text: "oi" }])).rejects.toThrow(/resposta vazia/);
  });
});
