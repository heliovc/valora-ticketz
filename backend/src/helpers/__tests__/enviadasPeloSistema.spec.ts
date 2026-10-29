import { marcarEnvioDoSistema, origemDoEnvio } from "../enviadasPeloSistema";

describe("mensagens que o próprio CRM enviou", () => {
  const T0 = 1_800_000_000_000;

  it("a abertura da automação é reconhecida no eco e não vira humano", () => {
    marcarEnvioDoSistema("3EB03A687251A93899E126", "automacao", T0);
    expect(origemDoEnvio("3EB03A687251A93899E126", T0 + 2_000)).toBe("automacao");
  });

  it("mensagem que ninguém marcou continua sendo do celular", () => {
    expect(origemDoEnvio("DIGITADA-NO-CELULAR", T0)).toBeNull();
    expect(origemDoEnvio(null, T0)).toBeNull();
  });

  it("a marca vence em 10 minutos", () => {
    marcarEnvioDoSistema("VENCE", "automacao", T0);
    expect(origemDoEnvio("VENCE", T0 + 9 * 60_000)).toBe("automacao");
    expect(origemDoEnvio("VENCE", T0 + 10 * 60_000)).toBeNull();
  });

  it("envio sem id não marca nada", () => {
    marcarEnvioDoSistema(undefined, "automacao", T0);
    expect(origemDoEnvio(undefined, T0)).toBeNull();
  });
});
