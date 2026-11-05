import {
  erroDeGravacao,
  marcarEnvioDoSistema,
  marcarErroDeGravacao,
  origemDoEnvio
} from "../enviadasPeloSistema";

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

describe("envio do CRM que não entrou na conversa", () => {
  const T0 = 1_800_000_000_000;

  it("guarda o erro do envio da automação para o worker ler", () => {
    marcarEnvioDoSistema("ENVIO-FIXO", "automacao", T0);
    marcarErroDeGravacao("ENVIO-FIXO", "ERR_WAPP_CONTACT_NOT_FOUND", T0 + 50);
    expect(erroDeGravacao("ENVIO-FIXO", T0 + 100)).toBe("ERR_WAPP_CONTACT_NOT_FOUND");
  });

  it("ignora erro de mensagem recebida: o mapa não cresce com o que chega do cliente", () => {
    marcarErroDeGravacao("RECEBIDA-DO-CLIENTE", "qualquer erro", T0);
    expect(erroDeGravacao("RECEBIDA-DO-CLIENTE", T0 + 1)).toBeNull();
  });

  it("o erro vence junto com a marca do envio", () => {
    marcarEnvioDoSistema("ENVIO-VELHO", "automacao", T0);
    marcarErroDeGravacao("ENVIO-VELHO", "erro", T0 + 1);
    expect(erroDeGravacao("ENVIO-VELHO", T0 + 11 * 60 * 1000)).toBeNull();
  });
});
