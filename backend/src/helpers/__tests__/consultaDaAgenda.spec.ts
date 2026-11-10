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
