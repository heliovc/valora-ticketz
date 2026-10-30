import { lerResultado, resultadoDaEtapaDeVendas } from "../encerramento";

describe("encerramento pela IA", () => {
  it("lê o resultado que o modelo escreveu, com variações", () => {
    expect(lerResultado("fechado")).toBe("fechado");
    expect(lerResultado(" Aceitou ")).toBe("fechado");
    expect(lerResultado("PERDIDO")).toBe("perdido");
    expect(lerResultado("sem interesse")).toBe("perdido");
    expect(lerResultado("talvez")).toBeNull();
    expect(lerResultado(undefined)).toBeNull();
  });

  it("Val: só a MUDANÇA de etapa encerra", () => {
    expect(resultadoDaEtapaDeVendas("novo", "sem_interesse")).toBe("perdido");
    expect(resultadoDaEtapaDeVendas("qualificado", "demo_solicitada")).toBe("fechado");
    expect(resultadoDaEtapaDeVendas("qualificado", "teste_solicitado")).toBe("fechado");
    // Mesma etapa na resposta seguinte: o gatilho não dispara de novo.
    expect(resultadoDaEtapaDeVendas("sem_interesse", "sem_interesse")).toBeNull();
    // Etapas do meio do caminho e transferência não são fim.
    expect(resultadoDaEtapaDeVendas("novo", "qualificado")).toBeNull();
    expect(resultadoDaEtapaDeVendas("qualificado", "transferido")).toBeNull();
    expect(resultadoDaEtapaDeVendas("novo", undefined)).toBeNull();
  });
});
