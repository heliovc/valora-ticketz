import {
  filtroDeCardAberto,
  precisaMigrarConexao
} from "../ticketLookupRules";

/**
 * Um número, um card — enquanto a conversa estiver aberta.
 *
 * O sintoma que motivou isto: a conexão de WhatsApp do lojista caiu, foi
 * recriada, e cada contato passou a ter DOIS cards no funil — um deles preso na
 * conexão morta, sem conseguir responder. Estes casos são o contrato que impede
 * a regra de voltar ao que era por "simetria" na próxima refatoração.
 */

describe("filtro do card aberto", () => {
  it("conversa 1:1 ignora a conexão e amarra por empresa e canal", () => {
    expect(
      filtroDeCardAberto({ contactId: 41, companyId: 2, whatsappId: 8, isGroup: false })
    ).toEqual({ contactId: 41, companyId: 2, channel: "whatsapp" });
  });

  it("conversa 1:1 NÃO filtra por conexão", () => {
    // É o ponto inteiro da mudança. Se `whatsappId` voltar aqui, o card preso
    // na conexão morta volta a existir.
    const filtro = filtroDeCardAberto({ contactId: 41, companyId: 2, whatsappId: 8, isGroup: false });
    expect(filtro).not.toHaveProperty("whatsappId");
  });

  it("conversa 1:1 exige companyId — sem a conexão, é o que separa as empresas", () => {
    // Duas empresas podem ter o mesmo contato. Sem `companyId` no filtro, a
    // mensagem de uma cairia no card da outra.
    const filtro = filtroDeCardAberto({ contactId: 41, companyId: 2, whatsappId: 8, isGroup: false });
    expect(filtro.companyId).toBe(2);
  });

  it("GRUPO mantém a conexão", () => {
    // Duas conexões no mesmo grupo são duas caixas de entrada. Unir vira eco.
    expect(
      filtroDeCardAberto({ contactId: 90, companyId: 2, whatsappId: 8, isGroup: true })
    ).toEqual({ contactId: 90, companyId: 2, whatsappId: 8 });
  });

  it("empresa que desligar a unificação volta a separar por conexão", () => {
    // Gancho para um Setting futuro. Hoje ninguém passa `false`.
    expect(
      filtroDeCardAberto({
        contactId: 41,
        companyId: 2,
        whatsappId: 8,
        isGroup: false,
        unificarConexoes: false
      })
    ).toEqual({ contactId: 41, companyId: 2, whatsappId: 8 });
  });
});

describe("migrar o card para a conexão que recebeu a mensagem", () => {
  it("migra quando a conexão do card é outra", () => {
    // Card nasceu na conexão 7 (caiu), mensagem chegou pela 8: o card vai
    // para a 8, senão a resposta do atendente não sai.
    expect(precisaMigrarConexao(7, 8, false)).toBe(true);
  });

  it("não mexe quando já é a mesma conexão", () => {
    expect(precisaMigrarConexao(8, 8, false)).toBe(false);
  });

  it("NUNCA migra grupo", () => {
    expect(precisaMigrarConexao(7, 8, true)).toBe(false);
  });

  it("card sem conexão gravada também migra", () => {
    expect(precisaMigrarConexao(null, 8, false)).toBe(true);
    expect(precisaMigrarConexao(undefined, 8, false)).toBe(true);
  });
});
