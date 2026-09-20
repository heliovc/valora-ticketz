import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { logger } from "../utils/logger";

/**
 * Extração de texto dos arquivos de consulta do bot.
 *
 * O objetivo não é fidelidade de diagramação: é o bot conseguir responder
 * "quanto custa o produto X". Por isso planilha vira CSV — a tabela em texto
 * corrido é o formato que o modelo lê melhor, e é o que mais se parece com a
 * forma como a pergunta chega.
 */

/** Teto por arquivo. Acima disso o texto é cortado, com marca no fim. */
export const MAX_CHARS_POR_ARQUIVO = 20000;

const EXT_PLANILHA = [".xlsx", ".xls", ".xlsm", ".ods"];
const EXT_TEXTO = [".txt", ".md", ".csv", ".tsv", ".json"];
const EXT_PDF = [".pdf"];

/** Extensões que o upload aceita. Qualquer outra é recusada na porta. */
export const EXTENSOES_ACEITAS = [
  ...EXT_PLANILHA,
  ...EXT_TEXTO,
  ...EXT_PDF
];

function cortar(texto: string): string {
  const limpo = texto.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (limpo.length <= MAX_CHARS_POR_ARQUIVO) return limpo;
  return `${limpo.slice(0, MAX_CHARS_POR_ARQUIVO)}\n[...arquivo cortado por tamanho...]`;
}

function dePlanilha(caminho: string): string {
  const wb = XLSX.readFile(caminho);
  // Uma planilha de preços costuma ter mais de uma aba (por categoria, por
  // tabela). Ler só a primeira perderia justamente o que o lojista quis subir.
  const partes = wb.SheetNames.map(nome => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[nome], { blankrows: false });
    return csv.trim() ? `--- ${nome} ---\n${csv.trim()}` : "";
  }).filter(Boolean);
  return partes.join("\n\n");
}

async function dePdf(caminho: string): Promise<string> {
  // Import tardio: a lib lê o arquivo de teste dela no import quando o módulo
  // é carregado de outro jeito, e nada mais no sistema depende de PDF.
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const pdfParse = require("pdf-parse");
  const buffer = fs.readFileSync(caminho);
  const resultado = await pdfParse(buffer);
  return String(resultado?.text || "");
}

/**
 * Lê o arquivo e devolve o texto. Nunca lança: arquivo ilegível vira string
 * vazia, e é a tela que avisa o lojista — derrubar o upload por causa de um
 * PDF escaneado seria pior, porque ele perde o arquivo e não entende por quê.
 */
export async function extrairTexto(
  caminho: string,
  nomeOriginal: string
): Promise<string> {
  const ext = path.extname(nomeOriginal).toLowerCase();
  try {
    if (EXT_PLANILHA.includes(ext)) return cortar(dePlanilha(caminho));
    if (EXT_PDF.includes(ext)) return cortar(await dePdf(caminho));
    if (EXT_TEXTO.includes(ext)) {
      return cortar(fs.readFileSync(caminho, "utf-8"));
    }
    return "";
  } catch (err) {
    logger.error({ err, nomeOriginal }, "[aiBot] falha ao extrair texto do arquivo");
    return "";
  }
}
