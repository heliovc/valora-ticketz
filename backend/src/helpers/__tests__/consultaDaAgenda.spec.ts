jest.mock("../../utils/logger", () => ({ __esModule: true, logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("axios", () => {
  const real = jest.requireActual("axios");
  return { __esModule: true, default: { post: jest.fn(), isAxiosError: real.isAxiosError } };
});

import axios from "axios";
import { generateBotReply, FerramentasParaOBot } from "../aiBot";
import {
  afirmaDisponibilidade,
  cobrancaDeConsulta,
  consultasAutomaticas,
  datasCitadas,
  pedeProposta,
  periodoCitado,
  tipoCitado
} from "../../services/AiBotServices/consultaDaAgenda";

// 10/11/2026, 09h em Brasília.
const AGORA = new Date("2026-11-10T12:00:00.000Z");
const NOMES = ["CONSULTAR_AGENDA", "PRE_RESERVAR"];

describe("datas citadas pelo cliente", () => {
  it("dd/mm/aaaa, dd/mm/aa e dd/mm (ano que vem se já passou)", () => {
    expect(datasCitadas("24/11/2026", AGORA)).toEqual(["24/11/2026"]);
    expect(datasCitadas("e dia 24/11/26?", AGORA)).toEqual(["24/11/2026"]);
    expect(datasCitadas("pode ser 24/11", AGORA)).toEqual(["24/11/2026"]);
    expect(datasCitadas("pode ser 05/01", AGORA)).toEqual(["05/01/2027"]);
  });

  it("por extenso", () => {
    expect(datasCitadas("dia 24 de novembro", AGORA)).toEqual(["24/11/2026"]);
    expect(datasCitadas("14 de março de 2027", AGORA)).toEqual(["14/03/2027"]);
  });

  it("ignora data passada, data impossível e números que não são data", () => {
    expect(datasCitadas("nasci em 12/03/1990", AGORA)).toEqual([]);
    expect(datasCitadas("31/02/2027", AGORA)).toEqual([]);
    expect(datasCitadas("crianças de 5-10 anos, jardim de 1.200 m², (21) 99226-6460", AGORA)).toEqual([]);
    expect(datasCitadas("festa de 15 anos em março", AGORA)).toEqual([]);
  });

  it("no máximo duas, sem repetir", () => {
    expect(datasCitadas("12/11, 24/11 ou 28/11? 24/11 é melhor", AGORA)).toEqual(["12/11/2026", "24/11/2026"]);
  });

  it("tipo de festa dito na mensagem", () => {
    expect(tipoCitado("casamento dia 24/11")).toBe("casamento");
    expect(tipoCitado("festa de quinze anos")).toBe("15_anos");
    expect(tipoCitado("é para festa infantil")).toBe("infantil");
    expect(tipoCitado("24/11/2026")).toBeUndefined();
  });

  it("só consulta sozinho quando a agenda está ligada", () => {
    expect(consultasAutomaticas(NOMES, "24/11/2026", AGORA)).toEqual([{ nome: "CONSULTAR_AGENDA", args: { data: "24/11/2026" } }]);
    expect(consultasAutomaticas(NOMES, "casamento 24/11", AGORA)).toEqual([
      { nome: "CONSULTAR_AGENDA", args: { data: "24/11/2026", _tipo: "casamento" } }
    ]);
    expect(consultasAutomaticas(["GERAR_PROPOSTA"], "24/11/2026", AGORA)).toEqual([]);
    expect(consultasAutomaticas(NOMES, "quero saber mais da casa", AGORA)).toEqual([]);
  });
});

describe("resposta que afirma disponibilidade", () => {
  it("pega a resposta inventada do caso real", () => {
    expect(
      afirmaDisponibilidade("O dia 24/11/2026 (terça-feira) também está livre nos três turnos: manhã (10h–14h), tarde (15h–19h).")
    ).toBe(true);
    expect(afirmaDisponibilidade("Infelizmente o sábado já está ocupado.")).toBe(true);
  });

  it("não pega conversa comum", () => {
    expect(afirmaDisponibilidade("Temos estacionamento próprio com 120 vagas e manobrista à noite.")).toBe(false);
    expect(afirmaDisponibilidade("Qual turno você prefere? E quantos convidados?")).toBe(false);
    expect(afirmaDisponibilidade("O cardápio está disponível no nosso Instagram.")).toBe(false);
  });

  it("não cobra quando a agenda foi consultada nesta resposta", () => {
    const r = "O dia 24/11 está livre.";
    expect(cobrancaDeConsulta(NOMES, r, [])).not.toBeNull();
    expect(cobrancaDeConsulta(NOMES, r, ["CONSULTAR_AGENDA"])).toBeNull();
    expect(cobrancaDeConsulta(["GERAR_PROPOSTA"], r, [])).toBeNull();
  });
});

describe("generateBotReply com a agenda", () => {
  const provedores = [{ provider: "openrouter" as const, model: "m", apiKey: "k" }];
  const responde = (...textos: string[]) => {
    for (const t of textos) (axios.post as jest.Mock).mockResolvedValueOnce({ data: { choices: [{ message: { content: t } }] } });
  };
  const mensagensDaChamada = (i: number) => (axios.post as jest.Mock).mock.calls[i][1].messages as Array<{ role: string; content: string }>;
  const ferramentas = (resultado = "24/11/2026 (terça-feira)\n- Espaço Kids: Manhã OCUPADO (bloqueado)\nResumo: OCUPADO."): FerramentasParaOBot & { executar: jest.Mock } => {
    const executar = jest.fn().mockResolvedValue(`CONSULTAR_AGENDA: ${resultado}`);
    return {
      nomes: NOMES,
      catalogo: "FERRAMENTAS",
      executar,
      automaticas: (m, agora) => consultasAutomaticas(NOMES, m, agora),
      cobrarConsulta: (r, ex) => cobrancaDeConsulta(NOMES, r, ex)
    };
  };
  const base = {
    persona: "Ana, da Villa Aurora",
    history: [
      { role: "user" as const, text: "12/11/2026" },
      { role: "assistant" as const, text: "O dia 12/11/2026 (quinta-feira) está livre nos três turnos." }
    ],
    userMessage: "24/11/2026",
    agora: AGORA,
    provedores
  };

  beforeEach(() => (axios.post as jest.Mock).mockReset());

  it("cliente manda uma data: consulta ANTES do modelo, que já responde com o resultado", async () => {
    const f = ferramentas();
    responde("Que pena, o dia 24/11 já está ocupado.");
    const r = await generateBotReply({ ...base, ferramentas: f });
    expect(f.executar).toHaveBeenCalledWith([{ nome: "CONSULTAR_AGENDA", args: { data: "24/11/2026" } }]);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const msgs = mensagensDaChamada(0);
    expect(msgs[msgs.length - 2]).toMatchObject({ role: "assistant", content: '[[CONSULTAR_AGENDA data="24/11/2026"]]' });
    expect(msgs[msgs.length - 1].content).toContain("OCUPADO (bloqueado)");
    expect(r).toEqual({ kind: "reply", text: "Que pena, o dia 24/11 já está ocupado." });
  });

  it("afirmou livre sem consultar: volta ao modelo, que consulta, e o cliente recebe a resposta certa", async () => {
    const f = ferramentas();
    responde(
      'O dia 30 também está livre! [[SALVAR campo="data_festa" valor="30/11"]]',
      '[[CONSULTAR_AGENDA data="30/11/2026"]]',
      "O dia 30/11 está ocupado. Posso te sugerir outras datas?"
    );
    const r = await generateBotReply({ ...base, userMessage: "e o dia 30?", ferramentas: f });
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(mensagensDaChamada(1).pop()?.content).toContain("NÃO foi consultada");
    expect(f.executar).toHaveBeenCalledWith([{ nome: "CONSULTAR_AGENDA", args: { data: "30/11/2026" } }]);
    expect(r?.text).toContain("O dia 30/11 está ocupado.");
    expect(r?.text).not.toContain("também está livre");
    // O SALVAR da resposta descartada não se perde.
    expect(r?.text).toContain('[[SALVAR campo="data_festa" valor="30/11"]]');
  });

  it("cobra uma vez só: se insistir, segue sem girar", async () => {
    const f = ferramentas();
    responde("O dia 30 está livre.", "O dia 30 está livre, sim.");
    const r = await generateBotReply({ ...base, userMessage: "e o dia 30?", ferramentas: f });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(r?.kind).toBe("reply");
  });

  it("conversa sem data: nada muda", async () => {
    const f = ferramentas();
    responde("Temos estacionamento com 120 vagas.");
    const r = await generateBotReply({ ...base, userMessage: "tem estacionamento?", ferramentas: f });
    expect(f.executar).not.toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ kind: "reply", text: "Temos estacionamento com 120 vagas." });
  });
});

describe("período aberto (10/11/2026: \"15 anos, na semana que vem\")", () => {
  // AGORA = terça, 10/11/2026.
  it("semana que vem, essa semana e fins de semana", () => {
    expect(periodoCitado("15 anos, na semana que vem", AGORA)).toEqual({ de: "16/11/2026", ate: "22/11/2026" });
    expect(periodoCitado("pode ser na próxima semana?", AGORA)).toEqual({ de: "16/11/2026", ate: "22/11/2026" });
    expect(periodoCitado("ainda essa semana", AGORA)).toEqual({ de: "11/11/2026", ate: "15/11/2026" });
    expect(periodoCitado("tem algo pra esse fim de semana?", AGORA)).toEqual({ de: "13/11/2026", ate: "15/11/2026" });
    expect(periodoCitado("no fim de semana que vem", AGORA)).toEqual({ de: "20/11/2026", ate: "22/11/2026" });
    // sábado: "esse fim de semana" é o que sobra dele
    expect(periodoCitado("esse fds", new Date("2026-11-14T15:00:00Z"))).toEqual({ de: "14/11/2026", ate: "15/11/2026" });
    // segunda: a semana que vem começa na outra segunda
    expect(periodoCitado("semana que vem", new Date("2026-11-16T15:00:00Z"))).toEqual({ de: "23/11/2026", ate: "29/11/2026" });
  });

  it("mês: que vem, esse, por nome (ano que vem se já passou) — e mês passado não conta", () => {
    expect(periodoCitado("mês que vem", AGORA)).toEqual({ mes: "12/2026" });
    expect(periodoCitado("ainda esse mês", AGORA)).toEqual({ mes: "11/2026" });
    expect(periodoCitado("casamento em maio de 2027", AGORA)).toEqual({ mes: "05/2027" });
    expect(periodoCitado("pensando em março", AGORA)).toEqual({ mes: "03/2027" });
    expect(periodoCitado("dezembro do ano que vem", AGORA)).toEqual({ mes: "12/2027" });
    expect(periodoCitado("casei em maio de 2020", AGORA)).toBeNull();
    expect(periodoCitado("quanto custa para 100 pessoas?", AGORA)).toBeNull();
  });

  it("vira consulta automática do período, com o tipo dito junto; data exata vence o período", () => {
    expect(consultasAutomaticas(NOMES, "15 anos, na semana que vem", AGORA)).toEqual([
      { nome: "CONSULTAR_AGENDA", args: { de: "16/11/2026", ate: "22/11/2026", _tipo: "15_anos" } }
    ]);
    expect(consultasAutomaticas(NOMES, "casamento em maio de 2027", AGORA)).toEqual([
      { nome: "CONSULTAR_AGENDA", args: { mes: "05/2027", _tipo: "casamento" } }
    ]);
    expect(consultasAutomaticas(NOMES, "dia 24/11 ou na semana que vem", AGORA)).toEqual([
      { nome: "CONSULTAR_AGENDA", args: { data: "24/11/2026" } }
    ]);
    expect(consultasAutomaticas(["GERAR_PROPOSTA"], "semana que vem", AGORA)).toEqual([]);
  });
});

describe("cliente pediu a proposta (11/11/2026: \"Quero o sábado. Me manda a proposta…\")", () => {
  const FRASE = "Quero o sábado. Me manda a proposta com a banda e o open bar premium. Ah, e queria fogos de artifício também";
  const TODAS = ["CONSULTAR_AGENDA", "PRE_RESERVAR", "GERAR_PROPOSTA", "COBRAR_SINAL"];

  it("reconhece o pedido, e não confunde com quem já recebeu ou quer fechar", () => {
    expect(pedeProposta(FRASE)).toBe(true);
    expect(pedeProposta("pode me enviar o orçamento?")).toBe(true);
    expect(pedeProposta("queria saber os valores")).toBe(true);
    expect(pedeProposta("me passa os preços pra 100 pessoas")).toBe(true);
    expect(pedeProposta("Não precisa pré-reservar ainda, me manda a proposta")).toBe(true);
    expect(pedeProposta("recebi a proposta, obrigada")).toBe(false);
    expect(pedeProposta("quero fechar a proposta")).toBe(false);
    expect(pedeProposta("não precisa da proposta ainda")).toBe(false);
    expect(pedeProposta("quanto fica o sinal?")).toBe(false);
    expect(pedeProposta("vou ver com meu marido")).toBe(false);
  });

  it("devolve ao modelo quando a proposta não saiu; nunca quando saiu ou não foi pedida", () => {
    const r = "Sábado, 21/11, está livre no Salão Jardim. Posso deixar pré-reservado por 48 horas?";
    expect(cobrancaDeConsulta(TODAS, r, ["CONSULTAR_AGENDA"], FRASE)).toMatchObject({
      texto: expect.stringContaining("GERAR_PROPOSTA"),
      soComFerramenta: true
    });
    // Caso Rafael (11/11/2026): pediu orçamento sem data — perguntar a data é o certo, não volta.
    expect(pedeProposta("Rafael. Queria fazer um orcamento para casamento")).toBe(true);
    expect(
      cobrancaDeConsulta(TODAS, "Oi, Rafael! Vou te ajudar com o orçamento do casamento. Qual a data ou o mês?", [], "Rafael. Queria fazer um orcamento para casamento")
    ).toBeNull();
    expect(cobrancaDeConsulta(TODAS, r, ["CONSULTAR_AGENDA", "GERAR_PROPOSTA"], FRASE)).toBeNull();
    expect(cobrancaDeConsulta(TODAS, "Aqui está: https://x.com/proposta/abc", ["CONSULTAR_AGENDA"], FRASE)).toBeNull();
    expect(cobrancaDeConsulta(TODAS, r, ["CONSULTAR_AGENDA"], "e o sábado?")).toBeNull();
    expect(cobrancaDeConsulta(NOMES, r, ["CONSULTAR_AGENDA"], FRASE)).toBeNull();
  });

  it("no motor: consultou, ofereceu só a pré-reserva → volta, gera a proposta e o cliente recebe o link", async () => {
    (axios.post as jest.Mock).mockReset();
    const executar = jest.fn()
      .mockResolvedValueOnce("CONSULTAR_AGENDA: 21/11/2026 (sábado)\n- Salão Jardim: LIVRE\nResumo: LIVRE.")
      .mockResolvedValueOnce("GERAR_PROPOSTA: Proposta criada. Link para o cliente: https://smartpay.valorasolucoes.com/proposta/abc123\n- 15 Anos Sonho: pacote R$ 24.000,00 + extras R$ 11.000,00 = R$ 35.000,00");
    const f: FerramentasParaOBot = {
      nomes: TODAS,
      catalogo: "FERRAMENTAS",
      executar,
      automaticas: (m, agora) => consultasAutomaticas(TODAS, m, agora),
      cobrarConsulta: (r, ex, m) => cobrancaDeConsulta(TODAS, r, ex, m)
    };
    for (const t of [
      '[[CONSULTAR_AGENDA data="21/11/2026"]]',
      "Sábado, 21/11, está livre! Posso deixar pré-reservado por 48 horas, sem compromisso?",
      '[[GERAR_PROPOSTA data="21/11/2026" extras="Banda ao vivo, Open bar premium" observacao="fogos de artifício"]]',
      "Sua proposta: https://smartpay.valorasolucoes.com/proposta/abc123 — total R$ 35.000,00."
    ]) (axios.post as jest.Mock).mockResolvedValueOnce({ data: { choices: [{ message: { content: t } }] } });
    const r = await generateBotReply({
      persona: "Ana, da Villa Aurora",
      history: [],
      userMessage: FRASE,
      agora: AGORA,
      provedores: [{ provider: "openrouter" as const, model: "m", apiKey: "k" }],
      ferramentas: f
    });
    expect(axios.post).toHaveBeenCalledTimes(4);
    expect(executar).toHaveBeenNthCalledWith(2, [
      { nome: "GERAR_PROPOSTA", args: { data: "21/11/2026", extras: "Banda ao vivo, Open bar premium", observacao: "fogos de artifício" } }
    ]);
    expect(r?.text).toContain("/proposta/abc123");
  });
});

describe("devolução só com ferramenta (11/11/2026: \"Você tem razão, vou gerar a proposta…\")", () => {
  const TODAS = ["CONSULTAR_AGENDA", "PRE_RESERVAR", "GERAR_PROPOSTA", "COBRAR_SINAL"];
  it("o modelo responde ao aviso em texto: o cliente recebe a resposta de antes, sem duplicar o SALVAR", async () => {
    (axios.post as jest.Mock).mockReset();
    const executar = jest.fn().mockResolvedValue("CONSULTAR_AGENDA: 21/11/2026 (sábado)\n- Salão Jardim: LIVRE");
    const f: FerramentasParaOBot = {
      nomes: TODAS,
      catalogo: "FERRAMENTAS",
      executar,
      automaticas: (m, agora) => consultasAutomaticas(TODAS, m, agora),
      cobrarConsulta: (r, ex, m) => cobrancaDeConsulta(TODAS, r, ex, m)
    };
    const antes = 'Sábado, 21/11, está livre! Posso pré-reservar por 48 horas? E quantos convidados vocês esperam? [[SALVAR campo="data_festa" valor="21/11/2026"]]';
    for (const t of [
      '[[CONSULTAR_AGENDA data="21/11/2026"]]',
      antes,
      "Você tem razão, vou gerar a proposta, mas preciso antes do número de convidados."
    ]) (axios.post as jest.Mock).mockResolvedValueOnce({ data: { choices: [{ message: { content: t } }] } });
    const r = await generateBotReply({
      persona: "Ana, da Villa Aurora",
      history: [],
      userMessage: "Quero o sábado, me manda a proposta",
      agora: AGORA,
      provedores: [{ provider: "openrouter" as const, model: "m", apiKey: "k" }],
      ferramentas: f
    });
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(r?.text).toBe(antes);
    expect(r?.text).not.toContain("Você tem razão");
  });
});
