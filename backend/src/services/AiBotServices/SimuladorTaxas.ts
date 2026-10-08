/**
 * Simulador de Taxas e Economia — a MESMA conta da página do Hélio
 * (claude.ai/artifact/FWJGsgZiMBcXGPKWS3zqLk), portada linha a linha.
 *
 * O bot não calcula: ele só pede a simulação com os dados do lead, e quem faz
 * a conta é esta função. Alterar aqui = alterar a página também, senão a
 * imagem do WhatsApp e o simulador do consultor passam a discordar.
 */

/** Simples Nacional — [teto RBT12, alíquota nominal %, parcela a deduzir R$]. */
const ANEXOS: Record<string, { nome: string; faixas: [number, number, number][] }> = {
  "1": {
    nome: "Comércio — Anexo I",
    faixas: [
      [180000, 4.0, 0],
      [360000, 7.3, 5940],
      [720000, 9.5, 13860],
      [1800000, 10.7, 22500],
      [3600000, 14.3, 87300],
      [4800000, 19.0, 378000]
    ]
  },
  "2": {
    nome: "Indústria — Anexo II",
    faixas: [
      [180000, 4.5, 0],
      [360000, 7.8, 5940],
      [720000, 10.0, 13860],
      [1800000, 11.2, 22500],
      [3600000, 14.7, 85500],
      [4800000, 30.0, 720000]
    ]
  },
  "3": {
    nome: "Serviços — Anexo III",
    faixas: [
      [180000, 6.0, 0],
      [360000, 11.2, 9360],
      [720000, 13.5, 17640],
      [1800000, 16.0, 35640],
      [3600000, 21.0, 125640],
      [4800000, 33.0, 648000]
    ]
  }
};

export interface Aliquota {
  ef: number;
  faixa: number;
  nominal: number;
  pd: number;
  acima: boolean;
}

export function aliqEfetiva(anexo: string, rbt12: number): Aliquota {
  const fx = ANEXOS[anexo].faixas;
  let i = 0;
  while (i < fx.length - 1 && rbt12 > fx[i][0]) i += 1;
  const [, nominal, pd] = fx[i];
  const ef = rbt12 > 0 ? ((rbt12 * nominal) / 100 - pd) / rbt12 * 100 : nominal;
  return { ef: Math.max(ef, 0), faixa: i + 1, nominal, pd, acima: rbt12 > 4800000 };
}

export interface EntradaDaSimulacao {
  /** Faturamento mensal em cartão (R$). */
  fat: number;
  /** Taxa atual do lead (%). */
  taxa1: number;
  /** Taxa proposta (%) — padrão da empresa, nunca do bot. */
  taxa2: number;
  /** "1" comércio, "2" indústria, "3" serviços. */
  anexo: string;
}

export interface ResultadoDaSimulacao extends EntradaDaSimulacao {
  anexoNome: string;
  rbt12: number;
  a1: Aliquota;
  a2: Aliquota;
  trib1: number;
  pct1: number;
  custo1: number;
  trib2: number;
  pct2: number;
  custo2: number;
  efetivaTotal2: number;
  economiaAnual: number;
  pctEconomia: number;
}

export function simular(e: EntradaDaSimulacao): ResultadoDaSimulacao {
  const anexo = ANEXOS[e.anexo] ? e.anexo : "1";
  const rbt12 = e.fat * 12;
  const a1 = aliqEfetiva(anexo, rbt12);
  const trib1 = e.fat;
  const pct1 = e.taxa1 + a1.ef;
  const custo1 = trib1 * (pct1 / 100);

  // Cenário 2 — alíquota efetiva recalculada sobre metade do faturamento anual
  const trib2 = e.fat / 2;
  const a2 = aliqEfetiva(anexo, rbt12 / 2);
  const pct2 = e.taxa2 + a2.ef;
  const custo2 = trib2 * (pct2 / 100);

  const economiaAnual = (custo1 - custo2) * 12;
  const pctEconomia = custo1 > 0 ? ((custo1 - custo2) / custo1) * 100 : 0;
  return {
    ...e,
    anexo,
    anexoNome: ANEXOS[anexo].nome,
    rbt12,
    a1,
    a2,
    trib1,
    pct1,
    custo1,
    trib2,
    pct2,
    custo2,
    efetivaTotal2: e.fat > 0 ? (custo2 / e.fat) * 100 : 0,
    economiaAnual,
    pctEconomia
  };
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtBRL = (n: number): string => brl.format(n);
export const fmtPct = (n: number): string => `${pct.format(n)}%`;

/** O texto que acompanha a imagem — números da conta, nunca do bot. */
export function legendaDaSimulacao(r: ResultadoDaSimulacao): string {
  if (r.economiaAnual < 0) {
    return [
      "Fiz a simulação com os seus números 👇",
      "",
      `📊 *Hoje*: custo total de ${fmtPct(r.pct1)} ≈ ${fmtBRL(r.custo1)}/mês`,
      `*Com a nossa proposta*: ${fmtBRL(r.custo2)}/mês`,
      "",
      "Neste cenário a sua condição atual já sai mais em conta — vou pedir para o consultor olhar o seu caso com calma.",
      "",
      "_Simulação estimada com base na tabela do Simples Nacional — pode sofrer pequenas variações._"
    ].join("\n");
  }
  return [
    "Fiz a simulação com os seus números 👇",
    "",
    `📊 *Hoje*: custo total de ${fmtPct(r.pct1)} ≈ ${fmtBRL(r.custo1)}/mês`,
    `✅ *Com a nossa proposta*: ${fmtBRL(r.custo2)}/mês (equivale a ${fmtPct(r.efetivaTotal2)} sobre o faturamento total)`,
    `💰 *Economia*: ${fmtBRL(r.economiaAnual)} por ano (${pct.format(r.pctEconomia)}% a menos que o custo atual)`,
    "",
    "_Simulação estimada com base na tabela do Simples Nacional — pode sofrer pequenas variações._"
  ].join("\n");
}
