import { liberadoParaTesteNoOficial } from "../testeDoNumeroDaEmpresa";

const teste = { numeros: ["5521936186570"], ate: new Date("2026-11-10T23:59:59-03:00") };
const antes = new Date("2026-11-09T15:00:00Z");

describe("exceção temporária: Val do Oficial responde ao número de teste", () => {
  it("libera o número de teste no Oficial dentro do prazo", () => {
    expect(liberadoParaTesteNoOficial("5521936186570", "whatsapp_official", antes, teste)).toBe(true);
  });

  it("aceita a forma sem o nono dígito, como a Meta às vezes manda", () => {
    expect(liberadoParaTesteNoOficial("552136186570", "whatsapp_official", antes, teste)).toBe(true);
  });

  it("no número normal (QR) a trava continua: um lado só responde", () => {
    expect(liberadoParaTesteNoOficial("5521936186570", "whatsapp", antes, teste)).toBe(false);
  });

  it("outro número da empresa continua travado", () => {
    expect(liberadoParaTesteNoOficial("5521992266460", "whatsapp_official", antes, teste)).toBe(false);
  });

  it("desliga sozinha depois do prazo", () => {
    expect(
      liberadoParaTesteNoOficial("5521936186570", "whatsapp_official", new Date("2026-11-11T03:00:00Z"), teste)
    ).toBe(false);
  });
});
