import {
  decidirAgendamento,
  decidirEnvio,
  JANELA_ANTI_DUPLICIDADE_SEGUNDOS
} from "../tagAutomationRules";

/**
 * Gatilho de lista do funil: card entra na lista X, o CRM manda a mensagem Y.
 *
 * Cada caso aqui é um jeito de a automação constranger o cliente do cliente:
 * mandar duas vezes, mandar para quem já saiu da lista, ou tocar o telefone de
 * alguém às três da manhã — que é também o que queima o número de WhatsApp.
 */

const AGORA = new Date("2026-08-31T14:00:00Z");
const lista = (extra: Record<string, unknown> = {}) => ({
  autoMessage: "Oi {{firstname}}, tudo certo?",
  autoOnce: true,
  companyId: 7,
  ...extra
});

describe("quando o card entra na lista", () => {
  it("agenda o envio quando a lista tem gatilho e é o primeiro disparo", () => {
    expect(decidirAgendamento(lista(), 7, null, AGORA)).toEqual({ agendar: true });
  });

  it("lista sem mensagem não dispara nada", () => {
    const d = decidirAgendamento(lista({ autoMessage: "   " }), 7, null, AGORA);
    expect(d).toEqual({ agendar: false, motivo: "lista sem gatilho" });
  });

  it("etiqueta de outra empresa nunca dispara mensagem nesta", () => {
    const d = decidirAgendamento(lista({ companyId: 99 }), 7, null, AGORA);
    expect(d.agendar).toBe(false);
  });

  it('"só na primeira vez": card que volta para a lista não dispara de novo', () => {
    const antigo = { createdAt: new Date("2026-08-01T10:00:00Z") };
    const d = decidirAgendamento(lista(), 7, antigo, AGORA);
    expect(d.agendar).toBe(false);
  });

  it("com repetição ligada, o card que volta dispara de novo", () => {
    const antigo = { createdAt: new Date("2026-08-01T10:00:00Z") };
    const d = decidirAgendamento(lista({ autoOnce: false }), 7, antigo, AGORA);
    expect(d).toEqual({ agendar: true });
  });

  it("dois cliques seguidos não viram duas mensagens, mesmo repetindo", () => {
    const agoraMesmo = {
      createdAt: new Date(AGORA.getTime() - (JANELA_ANTI_DUPLICIDADE_SEGUNDOS - 5) * 1000)
    };
    const d = decidirAgendamento(lista({ autoOnce: false }), 7, agoraMesmo, AGORA);
    expect(d.agendar).toBe(false);
  });

  it("lista apagada no meio do caminho não quebra nada", () => {
    expect(decidirAgendamento(null, 7, null, AGORA).agendar).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────

const envio = (extra: Record<string, unknown> = {}) => ({
  aindaNaLista: true,
  temMensagem: true,
  respeitaExpediente: true,
  dentroDoExpediente: true,
  postergacoes: 0,
  maxPostergacoes: 192,
  ...extra
});

describe("na hora de enviar", () => {
  it("envia quando o card ainda está na lista e o expediente está aberto", () => {
    expect(decidirEnvio(envio())).toEqual({ acao: "enviar" });
  });

  it("card que saiu da lista durante a espera NÃO recebe a mensagem", () => {
    const d = decidirEnvio(envio({ aindaNaLista: false }));
    expect(d).toEqual({
      acao: "descartar",
      motivo: "card saiu da lista antes do envio"
    });
  });

  it("fora do expediente, adia em vez de tocar o telefone de madrugada", () => {
    expect(decidirEnvio(envio({ dentroDoExpediente: false }))).toEqual({
      acao: "postergar"
    });
  });

  it("quem não pediu para respeitar expediente envia a qualquer hora", () => {
    const d = decidirEnvio(envio({ respeitaExpediente: false, dentroDoExpediente: false }));
    expect(d).toEqual({ acao: "enviar" });
  });

  it("não persegue o contato para sempre: depois do teto, descarta", () => {
    const d = decidirEnvio(
      envio({ dentroDoExpediente: false, postergacoes: 192, maxPostergacoes: 192 })
    );
    expect(d).toEqual({
      acao: "descartar",
      motivo: "expediente fechado por tempo demais"
    });
  });

  it("gatilho desligado depois de agendado não envia a mensagem antiga", () => {
    const d = decidirEnvio(envio({ temMensagem: false }));
    expect(d).toEqual({ acao: "descartar", motivo: "lista sem mensagem" });
  });

  it("card fora da lista vence o expediente fechado — descarta, não adia", () => {
    const d = decidirEnvio(envio({ aindaNaLista: false, dentroDoExpediente: false }));
    expect(d.acao).toBe("descartar");
  });
});
