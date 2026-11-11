jest.mock("../../../models/Ticket", () => ({ __esModule: true, default: class {} }));
jest.mock("../../../models/SalesAi", () => ({ __esModule: true, SalesAiConfig: class {} }));
jest.mock("../FerramentasDaVal", () => ({ __esModule: true, ferramentasDaVal: jest.fn() }));
jest.mock("../SalesAiService", () => ({
  __esModule: true,
  promptDeVendas: jest.fn(),
  produtosComPlaybook: jest.fn(),
  definirProdutoDaTriagem: jest.fn()
}));

import { ferramentasDaVal } from "../FerramentasDaVal";
import { definirProdutoDaTriagem, produtosComPlaybook, promptDeVendas } from "../SalesAiService";
import { responderComTriagem } from "../TriagemDaVal";

const FERRAMENTAS = { demoMarcada: () => null } as any;
const cfg = { companyId: 2, protocol: "" } as any;

beforeEach(() => {
  jest.clearAllMocks();
  (ferramentasDaVal as jest.Mock).mockResolvedValue(FERRAMENTAS);
  (produtosComPlaybook as jest.Mock).mockResolvedValue(["elo_eventos", "valora_saude"]);
  (promptDeVendas as jest.Mock).mockImplementation(async (_c: unknown, s: string) => `persona:${s}`);
  (definirProdutoDaTriagem as jest.Mock).mockImplementation(async (t: any, p: string) => {
    t.salesSource = p;
  });
});

describe("responderComTriagem", () => {
  it("conversa com produto: uma chamada, com a persona do produto e as ferramentas", async () => {
    const ticket = { id: 1, salesSource: "elo_eventos" } as any;
    const gerar = jest.fn().mockResolvedValue({ text: "Oi! Qual a data da festa?" });
    const r = await responderComTriagem(ticket, cfg, 9, gerar);
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(gerar).toHaveBeenCalledWith("persona:elo_eventos", FERRAMENTAS);
    expect(r).toEqual({ resposta: { text: "Oi! Qual a data da festa?" }, ferramentas: FERRAMENTAS });
    expect(definirProdutoDaTriagem).not.toHaveBeenCalled();
  });

  it("triagem sem produto claro: devolve a pergunta da Val, sem ferramentas", async () => {
    const ticket = { id: 1, salesSource: "triagem" } as any;
    const gerar = jest.fn().mockResolvedValue({ text: "Oi! Aqui é a Val, da Valora. Você tem casa de festas ou clínica?" });
    const r = await responderComTriagem(ticket, cfg, 9, gerar);
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(gerar).toHaveBeenCalledWith("persona:triagem", null);
    expect(r.ferramentas).toBeNull();
    expect(r.resposta?.text).toContain("casa de festas");
    expect(ferramentasDaVal).not.toHaveBeenCalled();
    expect(ticket.salesSource).toBe("triagem");
  });

  it("triagem descobre o produto: grava, e a resposta ao lead sai com a playbook dele", async () => {
    const ticket = { id: 1, salesSource: "triagem" } as any;
    const origens: string[] = [];
    const gerar = jest.fn().mockImplementation(async (persona: string) => {
      origens.push(ticket.salesSource);
      return persona === "persona:triagem"
        ? { text: "[[PRODUTO valora_saude]] [[RESUMO=clínica de cirurgia plástica]]" }
        : { text: "Que bom! Quantos procedimentos a clínica faz por mês?" };
    });
    const r = await responderComTriagem(ticket, cfg, 9, gerar);
    expect(definirProdutoDaTriagem).toHaveBeenCalledWith(ticket, "valora_saude");
    expect(gerar).toHaveBeenCalledTimes(2);
    expect(gerar).toHaveBeenLastCalledWith("persona:valora_saude", FERRAMENTAS);
    // O uso de IA da 2ª chamada já conta como do produto.
    expect(origens).toEqual(["triagem", "valora_saude"]);
    expect(r.resposta?.text).toBe("Que bom! Quantos procedimentos a clínica faz por mês?");
    expect(r.ferramentas).toBe(FERRAMENTAS);
  });

  it("produto que a empresa não oferece (sem playbook) não vale", async () => {
    (produtosComPlaybook as jest.Mock).mockResolvedValue(["elo_eventos"]);
    const ticket = { id: 1, salesSource: "triagem" } as any;
    const gerar = jest.fn().mockResolvedValue({ text: "[[PRODUTO valora_saude]]" });
    const r = await responderComTriagem(ticket, cfg, 9, gerar);
    expect(definirProdutoDaTriagem).not.toHaveBeenCalled();
    expect(gerar).toHaveBeenCalledTimes(1);
    expect(r.resposta?.text).toBe("[[PRODUTO valora_saude]]");
  });

  it("falha do provedor na triagem não tenta descobrir produto", async () => {
    const ticket = { id: 1, salesSource: "triagem" } as any;
    const falha = { text: "Só um momento…", falha: true };
    const gerar = jest.fn().mockResolvedValue(falha);
    const r = await responderComTriagem(ticket, cfg, 9, gerar);
    expect(r.resposta).toBe(falha);
    expect(produtosComPlaybook).not.toHaveBeenCalled();
  });

  it("IA sem resposta: nada a enviar", async () => {
    const ticket = { id: 1, salesSource: "triagem" } as any;
    const r = await responderComTriagem(ticket, cfg, 9, jest.fn().mockResolvedValue(null));
    expect(r).toEqual({ resposta: null, ferramentas: null });
  });
});
