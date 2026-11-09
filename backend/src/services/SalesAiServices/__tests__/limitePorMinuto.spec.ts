jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { ESPERA_DO_LIMITE_MS, MAX_TENTATIVAS_DO_LIMITE, tentarDepoisDoLimite } from "../SalesAiService";

/**
 * Disparo de 09/11/2026: com o limite por minuto atingido, a mensagem do lead
 * era descartada. Agora ganha nova tentativa depois.
 */
describe("limite por minuto: responder depois, não descartar", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("refaz a resposta depois da espera", async () => {
    const refazer = jest.fn().mockResolvedValue(undefined);
    expect(tentarDepoisDoLimite(101, 1, refazer, () => 0)).toBe(true);
    jest.advanceTimersByTime(ESPERA_DO_LIMITE_MS - 1);
    expect(refazer).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(refazer).toHaveBeenCalledTimes(1);
  });

  it("uma tentativa pendente por conversa: várias mensagens não viram várias respostas", () => {
    const refazer = jest.fn().mockResolvedValue(undefined);
    tentarDepoisDoLimite(102, 1, refazer, () => 0);
    tentarDepoisDoLimite(102, 1, refazer, () => 0);
    jest.advanceTimersByTime(ESPERA_DO_LIMITE_MS);
    expect(refazer).toHaveBeenCalledTimes(1);
  });

  it("desiste depois do máximo de tentativas seguidas", () => {
    const refazer = jest.fn().mockResolvedValue(undefined);
    expect(tentarDepoisDoLimite(103, MAX_TENTATIVAS_DO_LIMITE + 1, refazer, () => 0)).toBe(false);
    jest.advanceTimersByTime(ESPERA_DO_LIMITE_MS * 2);
    expect(refazer).not.toHaveBeenCalled();
  });

  it("falha na nova tentativa não derruba nada", async () => {
    const refazer = jest.fn().mockRejectedValue(new Error("caiu"));
    tentarDepoisDoLimite(104, 1, refazer, () => 0);
    jest.advanceTimersByTime(ESPERA_DO_LIMITE_MS);
    expect(refazer).toHaveBeenCalled();
  });
});
