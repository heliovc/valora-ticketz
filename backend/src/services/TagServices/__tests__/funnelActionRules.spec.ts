import {
  botDeveResponder,
  decidirAgendamento,
  decidirExecucao,
  ehAcaoSilenciosa,
  JANELA_ANTI_DUPLICIDADE_SEGUNDOS
} from "../funnelActionRules";

/**
 * Automação do funil: o card entra numa lista e o CRM age sozinho.
 *
 * Cada caso aqui é um jeito de a automação constranger o cliente do cliente —
 * mandar duas vezes, agir sobre quem já saiu da lista, tocar o telefone de
 * alguém às três da manhã — ou de o bot atropelar o atendente humano.
 */
const AGORA = new Date("2026-09-13T14:00:00Z");

const acao = (extra: Record<string, unknown> = {}) => ({
  id: 1,
  tipo: "mensagem",
  config: { mensagem: "Oi {{firstname}}, tudo certo?" },
  atrasoMinutos: 0,
  umaVezSo: true,
  soHorarioComercial: true,
  ativo: true,
  companyId: 7,
  ...extra
});

describe("agendar a ação", () => {
  it("agenda quando a ação é válida e é a primeira vez", () => {
    expect(decidirAgendamento(acao(), 7, null, AGORA)).toEqual({
      agendar: true,
      imediato: false
    });
  });

  it("ação desligada não agenda", () => {
    expect(decidirAgendamento(acao({ ativo: false }), 7, null, AGORA)).toEqual({
      agendar: false,
      motivo: "ação desligada"
    });
  });

  it("🚨 automação de OUTRA empresa nunca age nesta", () => {
    const d = decidirAgendamento(acao({ companyId: 99 }), 7, null, AGORA);
    expect(d).toEqual({ agendar: false, motivo: "automação de outra empresa" });
  });

  it("mensagem sem texto não agenda", () => {
    const d = decidirAgendamento(acao({ config: { mensagem: "  " } }), 7, null, AGORA);
    expect(d.agendar).toBe(false);
  });

  it("tipo desconhecido é ignorado em vez de quebrar", () => {
    // Ação gravada por uma versão mais nova do painel não pode derrubar o
    // executor de uma versão mais velha do servidor.
    const d = decidirAgendamento(acao({ tipo: "mover_lista" }), 7, null, AGORA);
    expect(d).toEqual({ agendar: false, motivo: "tipo desconhecido: mover_lista" });
  });

  it("'só na primeira vez' não repete", () => {
    const d = decidirAgendamento(acao(), 7, { createdAt: new Date("2026-09-01") }, AGORA);
    expect(d.agendar).toBe(false);
  });

  it("sem 'só na primeira vez', repete — mas não dois cliques seguidos", () => {
    const faz30s = new Date(AGORA.getTime() - 30_000);
    expect(
      decidirAgendamento(acao({ umaVezSo: false }), 7, { createdAt: faz30s }, AGORA).agendar
    ).toBe(false);

    const faz2min = new Date(AGORA.getTime() - 2 * 60_000);
    expect(
      decidirAgendamento(acao({ umaVezSo: false }), 7, { createdAt: faz2min }, AGORA).agendar
    ).toBe(true);
  });

  it("a janela anti-duplicidade é de um minuto", () => {
    expect(JANELA_ANTI_DUPLICIDADE_SEGUNDOS).toBe(60);
  });

  it("🚨 ligar o bot sem atraso roda NA HORA, fora da fila", () => {
    // É o que faz o bot responder a PRIMEIRA mensagem de uma conversa nova. Se
    // isso virar `imediato: false`, a mensagem passa pelo bot com a chave ainda
    // desligada e o cliente fica sem resposta.
    const d = decidirAgendamento(acao({ tipo: "bot_ligar", config: {} }), 7, null, AGORA);
    expect(d).toEqual({ agendar: true, imediato: true });
  });

  it("ligar o bot COM atraso vai para a fila", () => {
    const d = decidirAgendamento(
      acao({ tipo: "bot_ligar", config: {}, atrasoMinutos: 5 }),
      7,
      null,
      AGORA
    );
    expect(d).toEqual({ agendar: true, imediato: false });
  });

  it("mensagem nunca é imediata — sempre passa pela fila limitada", () => {
    // A fila tem limitador porque disparo automático é o que queima número de
    // WhatsApp.
    expect(decidirAgendamento(acao(), 7, null, AGORA)).toEqual({
      agendar: true,
      imediato: false
    });
  });
});

describe("executar a ação", () => {
  const base = {
    tipo: "mensagem",
    aindaNaLista: true,
    exigeLista: true,
    respeitaExpediente: true,
    dentroDoExpediente: true,
    postergacoes: 0,
    maxPostergacoes: 192
  };

  it("executa quando o card está na lista e o expediente está aberto", () => {
    expect(decidirExecucao(base)).toEqual({ acao: "executar" });
  });

  it("🚨 card que saiu da lista não recebe nada", () => {
    expect(decidirExecucao({ ...base, aindaNaLista: false })).toEqual({
      acao: "descartar",
      motivo: "card saiu da lista antes da execução"
    });
  });

  it("conversa nova não exige lista", () => {
    // A automação da Entrada não pertence a lista nenhuma; exigir uma
    // descartaria todas.
    expect(
      decidirExecucao({ ...base, exigeLista: false, aindaNaLista: false })
    ).toEqual({ acao: "executar" });
  });

  it("mensagem fora do expediente é adiada, não descartada", () => {
    expect(decidirExecucao({ ...base, dentroDoExpediente: false })).toEqual({
      acao: "postergar"
    });
  });

  it("mensagem adiada tempo demais é descartada em vez de perseguir o contato", () => {
    const d = decidirExecucao({
      ...base,
      dentroDoExpediente: false,
      postergacoes: 192
    });
    expect(d).toEqual({ acao: "descartar", motivo: "expediente fechado por tempo demais" });
  });

  it("🚨 ligar o bot IGNORA o expediente", () => {
    // Adiar "ligue o bot" até as 9h deixaria o cliente sem resposta a noite
    // inteira — o oposto do que o bot existe para fazer.
    expect(
      decidirExecucao({ ...base, tipo: "bot_ligar", dentroDoExpediente: false })
    ).toEqual({ acao: "executar" });
  });

  it("desligar o bot também ignora o expediente", () => {
    expect(
      decidirExecucao({ ...base, tipo: "bot_desligar", dentroDoExpediente: false })
    ).toEqual({ acao: "executar" });
  });

  it("ações de bot são silenciosas; mensagem não é", () => {
    expect(ehAcaoSilenciosa("bot_ligar")).toBe(true);
    expect(ehAcaoSilenciosa("bot_desligar")).toBe(true);
    expect(ehAcaoSilenciosa("mensagem")).toBe(false);
  });
});

describe("o bot responde nesta conversa?", () => {
  it("sem decisão da conversa, segue a empresa", () => {
    expect(botDeveResponder(null, true)).toBe(true);
    expect(botDeveResponder(null, false)).toBe(false);
    expect(botDeveResponder(undefined, true)).toBe(true);
  });

  it("🚨 conversa desligada vence a empresa ligada", () => {
    // O caso que mais importa: humano assumiu, o bot precisa calar. Bot
    // respondendo por cima do atendente é o erro que o cliente percebe na hora.
    expect(botDeveResponder(false, true)).toBe(false);
  });

  it("conversa ligada vence a empresa desligada", () => {
    // Triagem automática só em parte do funil, numa conta sem bot por padrão.
    expect(botDeveResponder(true, false)).toBe(true);
  });
});
