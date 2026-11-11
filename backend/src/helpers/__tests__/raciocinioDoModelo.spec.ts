jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { chamarProvedor, esquecerRecusasDeAjustes } from "../aiBot";

/**
 * Val, 10/11/2026: o Claude Sonnet 5.5 recusa "raciocínio desligado" (400); na
 * nova tentativa raciocinava com teto de 600 tokens e voltava vazio. Quem
 * respondia era o modelo de reserva — e confundiu o lead.
 */
const post = axios.post as jest.Mock;
const corpo = (i: number) => post.mock.calls[i][1];
const recusa = { isAxiosError: true, response: { status: 400, data: { error: { message: "Reasoning is mandatory" } } } };
const ok = (texto: string) => ({ data: { choices: [{ message: { content: texto }, finish_reason: "stop" }] } });
const sonnet = { provider: "openrouter" as const, model: "anthropic/claude-sonnet-5.5", apiKey: "k" };
const haiku = { provider: "openrouter" as const, model: "anthropic/claude-haiku-5.5", apiKey: "k" };

describe("modelo que recusa o raciocínio desligado", () => {
  beforeEach(() => {
    post.mockReset();
    esquecerRecusasDeAjustes();
  });

  it("recusou: tenta de novo sem os ajustes e com teto que cabe o raciocínio", async () => {
    post.mockRejectedValueOnce(recusa).mockResolvedValueOnce(ok("Claro! Sai por R$ 2.500 por mês."));
    const texto = await chamarProvedor(sonnet, "sistema", [{ role: "user", text: "quanto custa?" }]);
    expect(texto).toBe("Claro! Sai por R$ 2.500 por mês.");
    expect(corpo(0)).toMatchObject({ max_tokens: 600, reasoning: { enabled: false } });
    expect(corpo(1).reasoning).toBeUndefined();
    expect(corpo(1).max_tokens).toBe(2500);
  });

  it("da segunda vez vai direto sem os ajustes (sem o 400 de novo)", async () => {
    post.mockRejectedValueOnce(recusa).mockResolvedValueOnce(ok("primeira")).mockResolvedValueOnce(ok("segunda"));
    await chamarProvedor(sonnet, "sistema", [{ role: "user", text: "oi" }]);
    const texto = await chamarProvedor(sonnet, "sistema", [{ role: "user", text: "e aí?" }]);
    expect(texto).toBe("segunda");
    expect(post).toHaveBeenCalledTimes(3);
    expect(corpo(2).reasoning).toBeUndefined();
    expect(corpo(2).max_tokens).toBe(2500);
  });

  it("os outros modelos seguem com 600 tokens e o raciocínio desligado", async () => {
    post.mockRejectedValueOnce(recusa).mockResolvedValueOnce(ok("sonnet")).mockResolvedValueOnce(ok("haiku"));
    await chamarProvedor(sonnet, "sistema", [{ role: "user", text: "oi" }]);
    const texto = await chamarProvedor(haiku, "sistema", [{ role: "user", text: "oi" }]);
    expect(texto).toBe("haiku");
    expect(corpo(2)).toMatchObject({ model: "anthropic/claude-haiku-5.5", max_tokens: 600, reasoning: { enabled: false } });
  });
});
