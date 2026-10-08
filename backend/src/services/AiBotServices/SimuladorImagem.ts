import sharp from "sharp";
import { ResultadoDaSimulacao, fmtBRL, fmtPct } from "./SimuladorTaxas";

/**
 * A imagem da simulação, no mesmo desenho da página do simulador (cartões
 * "Cenário 1 / Cenário 2" e a faixa verde da economia). SVG desenhado aqui e
 * convertido em JPEG pelo `sharp` — sem navegador: o servidor tem pouca
 * memória, e abrir um Chromium por lead seria o primeiro a derrubá-lo.
 */

const COR = {
  bg: "#f5f6f4",
  surface: "#ffffff",
  alt: "#eef1ec",
  ink: "#1c2420",
  soft: "#5a655e",
  line: "#dde2db",
  accent: "#0e6f5c",
  accentInk: "#0a5546",
  accentSoft: "#e3f0ec",
  warn: "#b4551f",
  tile: "#f2f7f4"
};
const FONTE = "DejaVu Sans, sans-serif";

const esc = (t: string) =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function texto(
  x: number,
  y: number,
  t: string,
  o: { size?: number; weight?: number; cor?: string; anchor?: "start" | "end" | "middle" } = {}
): string {
  return `<text x="${x}" y="${y}" font-family="${FONTE}" font-size="${o.size ?? 14}" font-weight="${
    o.weight ?? 400
  }" fill="${o.cor ?? COR.ink}" text-anchor="${o.anchor ?? "start"}">${esc(t)}</text>`;
}

function campo(x: number, y: number, w: number, rotulo: string, valor: string, somenteLeitura: boolean): string {
  return [
    texto(x, y, rotulo, { size: 13, weight: 700 }),
    `<rect x="${x}" y="${y + 8}" width="${w}" height="40" rx="8" fill="${
      somenteLeitura ? COR.alt : COR.surface
    }" stroke="${COR.line}"/>`,
    texto(x + 12, y + 34, valor, { size: 16, cor: somenteLeitura ? COR.soft : COR.ink })
  ].join("");
}

function linha(x: number, y: number, w: number, rotulo: string, sub: string, valor: string, grande = false, ultima = false): string {
  return [
    texto(x, y, rotulo, { size: 13, cor: COR.soft }),
    texto(x, y + 16, sub, { size: 11, cor: COR.soft }),
    texto(x + w, y + 8, valor, {
      size: grande ? 18 : 15,
      weight: 700,
      cor: grande ? COR.accentInk : COR.ink,
      anchor: "end"
    }),
    ultima ? "" : `<line x1="${x}" y1="${y + 28}" x2="${x + w}" y2="${y + 28}" stroke="${COR.line}"/>`
  ].join("");
}

function cartao(
  x: number,
  y: number,
  w: number,
  h: number,
  titulo: string,
  tag: string,
  destaque: boolean,
  campos: Array<[string, string, boolean]>,
  saidas: Array<[string, string, string, boolean?]>
): string {
  const partes: string[] = [];
  partes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${COR.surface}" stroke="${COR.line}"/>`);
  partes.push(
    `<path d="M${x + 10},${y} h${w - 20} a10,10 0 0 1 10,10 v40 h${-w} v-40 a10,10 0 0 1 10,-10 z" fill="${
      destaque ? COR.accentSoft : COR.surface
    }"/>`
  );
  partes.push(`<line x1="${x}" y1="${y + 50}" x2="${x + w}" y2="${y + 50}" stroke="${COR.line}"/>`);
  partes.push(texto(x + 20, y + 32, titulo, { size: 16, weight: 700, cor: destaque ? COR.accentInk : COR.ink }));
  partes.push(texto(x + w - 20, y + 32, tag.toUpperCase(), { size: 11, weight: 700, cor: COR.soft, anchor: "end" }));
  let cy = y + 80;
  for (const [rot, val, ro] of campos) {
    partes.push(campo(x + 20, cy, w - 40, rot, val, ro));
    cy += 70;
  }
  const altura = saidas.length * 44 + 8;
  partes.push(`<rect x="${x + 20}" y="${cy}" width="${w - 40}" height="${altura}" rx="8" fill="${COR.alt}" stroke="${COR.line}"/>`);
  let sy = cy + 22;
  saidas.forEach(([rot, sub, val, grande], i) => {
    partes.push(linha(x + 34, sy, w - 68, rot, sub, val, !!grande, i === saidas.length - 1));
    sy += 44;
  });
  return partes.join("");
}

export async function imagemDaSimulacao(r: ResultadoDaSimulacao): Promise<Buffer> {
  const W = 880;
  const pad = 24;
  const colW = (W - pad * 2 - 20) / 2;
  const faixa = r.a1.acima
    ? `Faturamento anual de ${fmtBRL(r.rbt12)} — acima do limite do Simples Nacional (R$ 4,8 milhões/ano).`
    : `Faturamento anual: ${fmtBRL(r.rbt12)} · ${r.a1.faixa}ª faixa · alíquota nominal ${fmtPct(r.a1.nominal)} · efetiva ${fmtPct(r.a1.ef)}`;

  const topoCards = 200;
  const alturaCard = 50 + 30 + 3 * 70 + 4 * 44 + 8 + 20;
  const yResultado = topoCards + alturaCard + 22;
  const H = yResultado + 150 + pad;
  const positivo = r.economiaAnual >= 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${COR.bg}"/>
  ${texto(pad, 56, "Simulador de Taxas e Economia", { size: 30, weight: 700 })}
  ${texto(pad, 84, "Compare o custo mensal do cenário atual com o cenário proposto e veja a economia anual estimada.", { size: 14, cor: COR.soft })}
  <rect x="${pad}" y="104" width="${W - pad * 2}" height="76" rx="10" fill="${COR.surface}" stroke="${COR.line}"/>
  ${texto(pad + 20, 130, "Tipo de empresa (anexo do Simples Nacional)", { size: 13, weight: 700 })}
  ${texto(pad + 20, 152, r.anexoNome, { size: 15 })}
  ${texto(pad + 20, 170, faixa, { size: 11, cor: r.a1.acima ? COR.warn : COR.soft })}
  ${cartao(pad, topoCards, colW, alturaCard, "Cenário 1", "Situação atual", false,
    [
      ["Faturamento mensal em cartão", fmtBRL(r.fat), false],
      ["Taxa atual", fmtPct(r.taxa1), false],
      ["Alíquota efetiva", fmtPct(r.a1.ef), true]
    ],
    [
      ["Faturamento tributável", "= faturamento mensal", fmtBRL(r.trib1)],
      ["Custo total", "= taxa atual + alíquota", fmtPct(r.pct1)],
      ["Custo mensal", "= tributável × custo total", fmtBRL(r.custo1), true],
      ["", "", ""]
    ].filter(l => l[0]) as Array<[string, string, string, boolean?]>
  )}
  ${cartao(pad + colW + 20, topoCards, colW, alturaCard, "Cenário 2", "Cenário proposto", true,
    [
      ["Faturamento mensal em cartão", fmtBRL(r.fat), true],
      ["Taxa", fmtPct(r.taxa2), false],
      ["Alíquota efetiva (sobre metade)", fmtPct(r.a2.ef), true]
    ],
    [
      ["Faturamento tributável", "= faturamento ÷ 2", fmtBRL(r.trib2)],
      ["Custo total", "= taxa + alíquota da nova faixa", fmtPct(r.pct2)],
      ["Taxa efetiva sobre o total", "= custo mensal ÷ faturamento", fmtPct(r.efetivaTotal2)],
      ["Custo mensal", "= tributável × custo total", fmtBRL(r.custo2), true]
    ]
  )}
  <rect x="${pad}" y="${yResultado}" width="${W - pad * 2}" height="150" rx="12" fill="${positivo ? COR.accent : COR.warn}"/>
  ${texto(pad + 24, yResultado + 34, positivo ? "ECONOMIA ANUAL" : "CUSTO ADICIONAL ANUAL", { size: 13, weight: 700, cor: COR.tile })}
  ${texto(pad + 24, yResultado + 54, "= (custo mensal Cenário 1 − custo mensal Cenário 2) × 12", { size: 12, cor: COR.tile })}
  ${texto(W - pad - 24, yResultado + 52, fmtBRL(Math.abs(r.economiaAnual)), { size: 38, weight: 700, cor: COR.tile, anchor: "end" })}
  ${texto(pad + 24, yResultado + 88, positivo
    ? `Economia de ${fmtPct(r.pctEconomia)} comparada ao custo atual.`
    : `Aumento de ${fmtPct(Math.abs(r.pctEconomia))} comparado ao custo atual.`, { size: 16, weight: 700, cor: COR.tile })}
  ${texto(pad + 24, yResultado + 110, positivo
    ? `Equivale a ${fmtBRL(r.economiaAnual / 12)} de economia por mês.`
    : `O Cenário 2 fica ${fmtBRL(Math.abs(r.economiaAnual) / 12)} mais caro por mês.`, { size: 13, cor: COR.tile })}
  ${texto(pad + 24, yResultado + 134, "* Resultado baseado em estimativa, pode sofrer pequenas variações.", { size: 11, cor: COR.tile })}
</svg>`;

  return sharp(Buffer.from(svg), { density: 144 }).jpeg({ quality: 90 }).toBuffer();
}
