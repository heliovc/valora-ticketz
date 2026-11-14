import { mesmoNumero, nomeDaConexao, pinNovo, separarNumeroBrasileiro } from "../numerosDaContaRules";

describe("número novo na conta da Meta (14/11/2026)", () => {
  it("separa DDD e número em qualquer formato", () => {
    expect(separarNumeroBrasileiro("(21) 97474-4765")).toEqual({ cc: "55", numero: "21974744765" });
    expect(separarNumeroBrasileiro("+55 21 97474-4765")).toEqual({ cc: "55", numero: "21974744765" });
    expect(separarNumeroBrasileiro("2132221100")).toEqual({ cc: "55", numero: "2132221100" });
  });
  it("recusa número sem DDD, curto ou com DDD inválido", () => {
    expect(separarNumeroBrasileiro("97474-4765")).toBeNull();
    expect(separarNumeroBrasileiro("")).toBeNull();
    expect(separarNumeroBrasileiro("(01) 97474-4765")).toBeNull();
  });
  it("reconhece o número como a Meta mostra, com e sem o nono dígito", () => {
    expect(mesmoNumero("+55 21 97474-4765", "55", "21974744765")).toBe(true);
    expect(mesmoNumero("+55 21 7474-4765", "55", "21974744765")).toBe(true);
    expect(mesmoNumero("+55 21 99226-6460", "55", "21974744765")).toBe(false);
  });
  it("PIN tem 6 dígitos e nunca é todo igual", () => {
    const seq = [1, 1, 1, 1, 1, 1, 4, 0, 2, 9, 3, 7];
    let i = 0;
    const pin = pinNovo(() => seq[i++ % seq.length]);
    expect(pin).toMatch(/^\d{6}$/);
    expect(pin).toBe("402937");
  });
  it("nome da conexão: o pedido ou o número", () => {
    expect(nomeDaConexao("  WhatsApp   Vale Presente ", "+55 21 97474-4765")).toBe("WhatsApp Vale Presente");
    expect(nomeDaConexao("", "+55 21 97474-4765")).toBe("WhatsApp +55 21 97474-4765");
  });
});
