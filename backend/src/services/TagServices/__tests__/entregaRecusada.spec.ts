import { JANELA_DA_EXECUCAO_MS, escolherExecucao } from "../entregaRecusada";

jest.mock("../../../models/FunnelAction", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/TagAutomationRun", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../avisarFalhaDaAutomacao", () => ({ __esModule: true, avisarFalhaDaAutomacao: jest.fn() }));
jest.mock("../../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn() } }));

const em = new Date("2026-11-09T12:45:15.000Z");
const seg = (s: number) => new Date(em.getTime() + s * 1000);

describe("escolherExecucao", () => {
  it("pega o envio de modelo gravado logo depois da mensagem", () => {
    expect(
      escolherExecucao(
        [
          { id: 1, sentAt: seg(1), tipo: "bot_ligar" },
          { id: 2, sentAt: seg(2), tipo: "modelo" }
        ],
        em
      )?.id
    ).toBe(2);
  });

  it("com dois envios, fica com o mais perto da mensagem", () => {
    expect(
      escolherExecucao(
        [
          { id: 3, sentAt: seg(-200), tipo: "mensagem" },
          { id: 4, sentAt: seg(3), tipo: "mensagem" }
        ],
        em
      )?.id
    ).toBe(4);
  });

  it("ignora o que está fora da folga, sem sentAt ou que não envia mensagem", () => {
    const longe = JANELA_DA_EXECUCAO_MS / 1000 + 10;
    expect(
      escolherExecucao(
        [
          { id: 5, sentAt: seg(longe), tipo: "modelo" },
          { id: 6, sentAt: null, tipo: "modelo" },
          { id: 7, sentAt: seg(1), tipo: "mover" }
        ],
        em
      )
    ).toBeNull();
  });
});
