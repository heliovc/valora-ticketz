jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { chamarProvedor } from "../aiBot";

const erro400 = Object.assign(new Error("400"), {
  isAxiosError: true,
  response: { status: 400, data: { error: { message: "reasoning cannot be disabled" } } }
});

describe("OpenRouter: modelo que recusa um ajuste (Claude Sonnet 5.5, 09/11/2026)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("400 com os ajustes: tenta de novo só com o essencial e responde", async () => {
    (axios.post as jest.Mock)
      .mockRejectedValueOnce(erro400)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: "Olá!" } }] } });
    const r = await chamarProvedor({ provider: "openrouter", model: "anthropic/claude-sonnet-5.5", apiKey: "k" } as any, "sys", [
      { role: "user", text: "oi" }
    ]);
    expect(r).toBe("Olá!");
    const [, primeiro] = (axios.post as jest.Mock).mock.calls[0];
    const [, segundo] = (axios.post as jest.Mock).mock.calls[1];
    expect(primeiro).toHaveProperty("reasoning");
    expect(segundo).not.toHaveProperty("reasoning");
    expect(segundo).not.toHaveProperty("temperature");
    expect(segundo.model).toBe("anthropic/claude-sonnet-5.5");
  });

  it("outro erro (ex.: 401) sobe para o próximo modelo da lista", async () => {
    const e401 = Object.assign(new Error("401"), { isAxiosError: true, response: { status: 401, data: {} } });
    (axios.post as jest.Mock).mockRejectedValueOnce(e401);
    await expect(
      chamarProvedor({ provider: "openrouter", model: "x", apiKey: "k" } as any, "sys", [{ role: "user", text: "oi" }])
    ).rejects.toBeTruthy();
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});
