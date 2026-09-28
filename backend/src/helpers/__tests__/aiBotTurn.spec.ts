import { buildSystemPrompt } from "../aiBot";
import {
  jaSeApresentou,
  nomeParaOBot,
  saudacaoDoPeriodo,
  separarTurnoAtual
} from "../aiBotTurn";

/**
 * Conversa real de 28/09/2026 que originou estas regras: "Oi" + "Boa tarde
 * tudo bem" às 14h57 receberam duas respostas, com duas apresentações e um
 * "bom dia" à tarde.
 */
const TARDE = new Date("2026-09-28T17:57:00Z"); // 14:57 em Brasília

describe("saudação pelo horário de Brasília", () => {
  it("14h57 é boa tarde, mesmo com o servidor em UTC", () => {
    expect(saudacaoDoPeriodo(TARDE)).toBe("boa tarde");
  });
  it("9h é bom dia e 21h é boa noite", () => {
    expect(saudacaoDoPeriodo(new Date("2026-09-28T12:00:00Z"))).toBe("bom dia");
    expect(saudacaoDoPeriodo(new Date("2026-09-29T00:00:00Z"))).toBe(
      "boa noite"
    );
  });
});

describe("nome do contato", () => {
  it("corrige a caixa do nome de perfil", () => {
    expect(nomeParaOBot("malick")).toBe("Malick");
    expect(nomeParaOBot("MARIA da silva")).toBe("Maria Da Silva");
  });
  it("número no lugar do nome não vira nome", () => {
    expect(nomeParaOBot("5521978901233")).toBeUndefined();
    expect(nomeParaOBot("")).toBeUndefined();
  });
});

describe("turno a responder", () => {
  it("junta as mensagens seguidas do cliente numa só", () => {
    const { history, pendente } = separarTurnoAtual([
      { fromMe: false, body: "Oi" },
      { fromMe: false, body: "Boa tarde tudo bem" }
    ]);
    expect(history).toEqual([]);
    expect(pendente).toBe("Oi\nBoa tarde tudo bem");
  });

  it("só o que veio depois da nossa última fala está pendente", () => {
    const { history, pendente } = separarTurnoAtual([
      { fromMe: false, body: "Oi" },
      { fromMe: true, body: "Boa tarde, Malick! Sou a Val." },
      { fromMe: false, body: "Onde você fica no centro" }
    ]);
    expect(history).toHaveLength(2);
    expect(pendente).toBe("Onde você fica no centro");
    expect(jaSeApresentou(history)).toBe(true);
  });

  it("nada pendente quando a última fala é nossa", () => {
    expect(
      separarTurnoAtual([
        { fromMe: false, body: "Oi" },
        { fromMe: true, body: "Olá!" }
      ]).pendente
    ).toBe("");
  });
});

describe("prompt", () => {
  it("manda dizer boa tarde e se apresentar só na primeira resposta", () => {
    const primeira = buildSystemPrompt("Você é a Val.", "", [], {
      contactName: "malick",
      agora: TARDE,
      jaConversou: false
    });
    expect(primeira).toContain('"boa tarde"');
    expect(primeira).toContain("Malick");
    expect(primeira).toContain("apresente-se uma única vez");

    const seguinte = buildSystemPrompt("Você é a Val.", "", [], {
      agora: TARDE,
      jaConversou: true
    });
    expect(seguinte).toContain("Você JÁ se apresentou");
  });
});
