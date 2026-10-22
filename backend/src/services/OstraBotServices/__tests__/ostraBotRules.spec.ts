import {
  dentroDoHorario,
  descreverMidia,
  extrairPergunta,
  formatarParaOGrupo,
  formatarAviso,
  formatarRascunhoParaOHelio,
  interpretarComando,
  perguntaDeResposta,
  prazoDoRascunho,
  proximaAbertura
} from "../ostraBotRules";

// Horários de Brasília escritos em UTC (+3h).
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("extrairPergunta", () => {
  it.each([
    [
      "Claude, quanto fica 100 taças a R$ 3,80?",
      "quanto fica 100 taças a R$ 3,80?"
    ],
    ["claude: tem fornecedor de gelo?", "tem fornecedor de gelo?"],
    ["CLAUDE quanto custa", "quanto custa"],
    ["  Claude,   oi", "oi"]
  ])("aceita %p", (texto, esperado) => {
    expect(extrairPergunta(texto)).toBe(esperado);
  });

  it.each([
    "Claudete, tudo bem?",
    "Fala Claude, quanto fica?",
    "Claude",
    "Claude,  ",
    "",
    null
  ])("ignora %p", texto => {
    expect(extrairPergunta(texto as string)).toBeNull();
  });
});

describe("interpretarComando", () => {
  it("lê ok, não e editar", () => {
    expect(interpretarComando("ok 12")).toEqual({ tipo: "ok", id: 12 });
    expect(interpretarComando("OK #12")).toEqual({ tipo: "ok", id: 12 });
    expect(interpretarComando("não 7")).toEqual({ tipo: "nao", id: 7 });
    expect(interpretarComando("nao 7")).toEqual({ tipo: "nao", id: 7 });
    expect(interpretarComando("editar 3 Fica R$ 380,00 no total.")).toEqual({
      tipo: "editar",
      id: 3,
      texto: "Fica R$ 380,00 no total."
    });
  });

  it("não confunde conversa com comando", () => {
    expect(interpretarComando("ok")).toBeNull();
    expect(interpretarComando("ok, vou ver 12 coisas")).toBeNull();
    expect(interpretarComando("editar 3")).toBeNull();
    expect(interpretarComando("#3 Pedido de Dani")).toBeNull();
  });
});

describe("horário do grupo", () => {
  it("abre às 8h e fecha às 21h em Brasília", () => {
    expect(dentroDoHorario(brt("2026-10-21T07:59"))).toBe(false);
    expect(dentroDoHorario(brt("2026-10-21T08:00"))).toBe(true);
    expect(dentroDoHorario(brt("2026-10-21T20:59"))).toBe(true);
    expect(dentroDoHorario(brt("2026-10-21T21:00"))).toBe(false);
  });

  it("depois das 21h a próxima abertura é amanhã às 8h", () => {
    expect(proximaAbertura(brt("2026-10-21T23:30")).toISOString()).toBe(
      brt("2026-10-22T08:00").toISOString()
    );
  });

  it("de madrugada a próxima abertura é hoje às 8h", () => {
    expect(proximaAbertura(brt("2026-10-22T02:10")).toISOString()).toBe(
      brt("2026-10-22T08:00").toISOString()
    );
  });

  it("rascunho da noite só expira 2h depois da abertura", () => {
    expect(prazoDoRascunho(brt("2026-10-21T23:30")).toISOString()).toBe(
      brt("2026-10-22T10:00").toISOString()
    );
    expect(prazoDoRascunho(brt("2026-10-21T15:00")).toISOString()).toBe(
      brt("2026-10-21T17:00").toISOString()
    );
  });
});

describe("formatarParaOGrupo", () => {
  it("corta em 4 linhas e põe o prefixo uma vez", () => {
    const texto = "🤖 a\n\nb\nc\nd\ne";
    expect(formatarParaOGrupo(texto)).toBe("🤖 a\nb\nc\nd");
  });
});

describe("formatarRascunhoParaOHelio", () => {
  it("segue o formato pedido", () => {
    const msg = formatarRascunhoParaOHelio({
      id: 5,
      autor: "Dani",
      pergunta: "quanto fica?",
      rascunho: "🤖 R$ 380",
      foraDoHorario: false
    });
    expect(msg).toContain('#5 Pedido de Dani: "quanto fica?"');
    expect(msg).toContain("Rascunho: 🤖 R$ 380");
    expect(msg).toContain(
      'Responda "ok 5" para enviar, "não 5" para descartar'
    );
  });
});

describe("descreverMidia", () => {
  it("rotula foto, áudio e PDF", () => {
    expect(descreverMidia({ tipo: "imageMessage" })).toBe("[foto]");
    expect(descreverMidia({ tipo: "audioMessage" })).toBe("[áudio]");
    expect(
      descreverMidia({ tipo: "documentMessage", nomeArquivo: "orcamento.pdf" })
    ).toBe("[PDF: orcamento.pdf]");
  });
});

describe("perguntaDeResposta", () => {
  it("resposta citando o bot vira pergunta, com o trecho citado", () => {
    const p = perguntaDeResposta("Sim", "🤖 Quer que eu monte um rascunho?");
    expect(p).toContain("Sim");
    expect(p).toContain("Quer que eu monte um rascunho?");
  });

  it("ignora citação de mensagem que não é do bot e mensagens do próprio bot", () => {
    expect(perguntaDeResposta("Sim", "Vamos fechar o carrinho?")).toBeNull();
    expect(perguntaDeResposta("🤖 Atualizei", "🤖 algo")).toBeNull();
    expect(perguntaDeResposta("", "🤖 algo")).toBeNull();
  });
});

describe("formatarAviso", () => {
  it("põe o prefixo uma vez e não corta em 4 linhas", () => {
    const aviso = formatarAviso("🤖 a\nb\nc\nd\ne");
    expect(aviso).toBe("🤖 a\nb\nc\nd\ne");
  });
});
