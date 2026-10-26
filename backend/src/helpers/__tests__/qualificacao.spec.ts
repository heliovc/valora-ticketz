import {
  CampoQualificavel,
  blocoDeQualificacao,
  estadoDaQualificacao,
  interpretarData,
  interpretarMoeda,
  interpretarNumero,
  notaDoLead,
  validarValor
} from "../qualificacao";

/** Campos do Elo Eventos, como a Valora grava em `aiBotFields`. */
const CAMPOS: CampoQualificavel[] = [
  { nome: "nome", descricao: "Nome", tipo: "texto", aplicaA: ["comum"], obrigatorio: true, ordem: 1 },
  { nome: "tipo_festa", descricao: "Tipo", tipo: "opcao", aplicaA: ["comum"], obrigatorio: true, ordem: 2, opcoes: ["casamento", "15_anos", "infantil"] },
  { nome: "data_festa", descricao: "Data", tipo: "data", aplicaA: ["comum"], obrigatorio: true, ordem: 3 },
  { nome: "convidados", descricao: "Convidados", tipo: "numero", aplicaA: ["comum"], obrigatorio: true, ordem: 5 },
  { nome: "orcamento", descricao: "Orçamento", tipo: "moeda", aplicaA: ["comum"], obrigatorio: true, ordem: 6 },
  { nome: "como_conheceu", descricao: "Como conheceu", tipo: "texto", aplicaA: ["comum"], obrigatorio: false, ordem: 7 },
  { nome: "cerimonia_no_local", descricao: "Cerimônia no local", tipo: "sim_nao", aplicaA: ["casamento"], obrigatorio: true, ordem: 10 },
  { nome: "nome_crianca", descricao: "Nome da criança", tipo: "texto", aplicaA: ["infantil"], obrigatorio: true, ordem: 30 },
  { nome: "turno", descricao: "Turno", tipo: "opcao", aplicaA: ["infantil"], obrigatorio: true, ordem: 34, opcoes: ["manhã", "tarde", "noite"] }
];

const HOJE = new Date(2026, 9, 26); // 26/10/2026

describe("próxima pergunta", () => {
  it("começa pelo nome e segue a ordem", () => {
    const e = estadoDaQualificacao(CAMPOS, {});
    expect(e.proximo?.nome).toBe("nome");
    expect(estadoDaQualificacao(CAMPOS, { nome: "Renata" }).proximo?.nome).toBe("tipo_festa");
  });

  it("campos do tipo só entram depois que o tipo é conhecido", () => {
    const semTipo = estadoDaQualificacao(CAMPOS, { nome: "Renata" });
    expect(semTipo.aplicaveis.map(c => c.nome)).not.toContain("cerimonia_no_local");
    const casamento = estadoDaQualificacao(CAMPOS, { nome: "Renata", tipo_festa: "casamento" });
    expect(casamento.aplicaveis.map(c => c.nome)).toContain("cerimonia_no_local");
    expect(casamento.aplicaveis.map(c => c.nome)).not.toContain("nome_crianca");
  });

  it("obrigatório que falta vence opcional, mesmo vindo depois na ordem", () => {
    const e = estadoDaQualificacao(CAMPOS, {
      nome: "Renata", tipo_festa: "casamento", data_festa: "2027-03-14", convidados: "120", orcamento: "30000"
    });
    expect(e.proximo?.nome).toBe("cerimonia_no_local");
    expect(e.faltamObrigatorios.map(c => c.nome)).toEqual(["cerimonia_no_local"]);
  });

  it("sem obrigatório faltando, pergunta o opcional e depois encerra", () => {
    const base = { nome: "R", tipo_festa: "casamento", data_festa: "2027-03-14", convidados: "120", orcamento: "30000", cerimonia_no_local: "sim" };
    expect(estadoDaQualificacao(CAMPOS, base).proximo?.nome).toBe("como_conheceu");
    const completo = estadoDaQualificacao(CAMPOS, { ...base, como_conheceu: "Instagram" });
    expect(completo.proximo).toBeNull();
    expect(blocoDeQualificacao(completo, { ...base, como_conheceu: "Instagram" }, "quente")).toContain("Qualificação completa");
  });

  it("o bloco do prompt traz a única pergunta da vez", () => {
    const e = estadoDaQualificacao(CAMPOS, { nome: "Renata" });
    const bloco = blocoDeQualificacao(e, { nome: "Renata" }, null);
    expect(bloco).toContain("PRÓXIMA PERGUNTA: tipo_festa");
    expect(bloco).toContain("Opções: casamento, 15_anos, infantil");
    expect(bloco).toContain("- nome: Renata ✔");
  });
});

describe("validação por tipo", () => {
  it("datas em vários formatos viram ISO", () => {
    expect(interpretarData("14/03/2027", HOJE)).toBe("2027-03-14");
    expect(interpretarData("14/3/27", HOJE)).toBe("2027-03-14");
    expect(interpretarData("14 de março de 2027", HOJE)).toBe("2027-03-14");
    expect(interpretarData("março de 2027", HOJE)).toBe("2027-03");
    expect(interpretarData("03/2027", HOJE)).toBe("2027-03");
    expect(interpretarData("dia 14/03", HOJE)).toBe("2027-03-14"); // já passou em 2026 → próximo ano
    expect(interpretarData("em dezembro", HOJE)).toBe("2026-12");
    expect(interpretarData("ainda não sei", HOJE)).toBeNull();
  });

  it("números e dinheiro", () => {
    expect(interpretarNumero("uns 120 convidados")).toBe(120);
    expect(interpretarNumero("entre 100 e 150")).toBe(150);
    expect(interpretarMoeda("R$ 30.000,00")).toBe(30000);
    expect(interpretarMoeda("30 mil")).toBe(30000);
    expect(interpretarMoeda("30k")).toBe(30000);
    expect(interpretarMoeda("entre 20 e 30 mil")).toBe(30000);
    expect(interpretarMoeda("sei lá")).toBeNull();
  });

  it("opções aceitam sinônimos e sim/não aceita jeitos de falar", () => {
    const tipo = CAMPOS[1];
    expect(validarValor(tipo, "é um casamento")).toEqual({ ok: true, valor: "casamento" });
    expect(validarValor(tipo, "festa de 15 da minha filha")).toEqual({ ok: true, valor: "15_anos" });
    expect(validarValor(tipo, "aniversário infantil")).toEqual({ ok: true, valor: "infantil" });
    expect(validarValor(tipo, "corporativo").ok).toBe(false);
    const sn = CAMPOS[6];
    expect(validarValor(sn, "sim, no local")).toEqual({ ok: true, valor: "sim" });
    expect(validarValor(sn, "não, vai ser na igreja")).toEqual({ ok: true, valor: "não" });
    expect(validarValor(sn, "talvez").ok).toBe(false);
  });
});

describe("nota do lead", () => {
  const ctx = { capacidade: { casamento: 250 }, piso: { casamento: 12500 } };
  it("quente: data em 12 meses, cabe no salão, orçamento acima do piso", () => {
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "2027-03-14", convidados: "120", orcamento: "30000" }, ctx, HOJE)).toBe("quente");
  });
  it("morno: falta um critério", () => {
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "2027-03-14", convidados: "300", orcamento: "30000" }, ctx, HOJE)).toBe("morno");
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "2028-06-10", convidados: "120", orcamento: "30000" }, ctx, HOJE)).toBe("morno");
  });
  it("frio: sem data ou faltando mais de um", () => {
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "ainda não sei", convidados: "120", orcamento: "30000" }, ctx, HOJE)).toBe("frio");
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "2028-06-10", convidados: "300", orcamento: "5000" }, ctx, HOJE)).toBe("frio");
  });
  it("sem convidados ou orçamento ainda não dá nota", () => {
    expect(notaDoLead({ tipo_festa: "casamento", data_festa: "2027-03-14" }, ctx, HOJE)).toBeNull();
  });
});
