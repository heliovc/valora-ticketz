import type { ChamadaDeFerramenta } from "../../helpers/aiBot";

/**
 * Agenda sem depender da memória do modelo.
 *
 * Caso real (Villa Aurora, 10/11/2026): o cliente perguntou 12/11 e o bot
 * consultou; logo depois perguntou 24/11 — dia BLOQUEADO na agenda — e o bot
 * respondeu "também está livre" sem consultar, copiando a resposta anterior.
 * A instrução "nunca invente disponibilidade" já estava no prompt.
 *
 * Duas travas, as duas fora do modelo:
 * 1. a mensagem do cliente traz uma data → o sistema consulta ANTES de o
 *    modelo responder (`consultasAutomaticas`);
 * 2. a resposta afirma livre/ocupado sem consulta nesta rodada → volta para o
 *    modelo antes de chegar ao cliente (`cobrancaDeConsulta`).
 */

const FUSO = "America/Sao_Paulo";
const MAX_DATAS = 2;
const ANOS_A_FRENTE = 3;
const MESES = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
];

const pad = (n: number) => String(n).padStart(2, "0");
const semAcento = (t: string) =>
  String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Datas de hoje em diante citadas na mensagem, em dd/mm/aaaa: "24/11/2026",
 * "24/11/26", "24/11" (ano que vem se o dia já passou), "24 de novembro".
 * Data passada (nascimento, festa antiga) fica de fora.
 */
export function datasCitadas(texto: string, agora: Date): string[] {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: FUSO }); // AAAA-MM-DD
  const [anoHoje, mesHoje, diaHoje] = hoje.split("-").map(Number);
  const t = semAcento(texto);
  const achadas: string[] = [];
  const add = (dia: number, mes: number, anoDito: number | null) => {
    if (mes < 1 || mes > 12 || dia < 1) return;
    let ano: number;
    if (anoDito == null) ano = mes < mesHoje || (mes === mesHoje && dia < diaHoje) ? anoHoje + 1 : anoHoje;
    else ano = anoDito < 100 ? 2000 + anoDito : anoDito;
    if (dia > new Date(Date.UTC(ano, mes, 0)).getUTCDate()) return;
    if (`${ano}-${pad(mes)}-${pad(dia)}` < hoje || ano > anoHoje + ANOS_A_FRENTE) return;
    const br = `${pad(dia)}/${pad(mes)}/${ano}`;
    if (!achadas.includes(br)) achadas.push(br);
  };
  // Só "/" como separador: "5-10 anos" e "1.200 m²" não são datas.
  for (const m of t.matchAll(/(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}|\d{2}))?(?![\d/])/g)) {
    add(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  const porExtenso = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:de\\s+)?(${MESES.join("|")})(?:\\s*(?:de\\s+)?(\\d{4}))?`, "g");
  for (const m of t.matchAll(porExtenso)) {
    add(Number(m[1]), MESES.indexOf(m[2]) + 1, m[3] ? Number(m[3]) : null);
  }
  return achadas.slice(0, MAX_DATAS);
}

/**
 * Tipo de festa dito na própria mensagem ("casamento dia 24/11"). Só é usado
 * quando o cadastro ainda não tem o tipo — o SALVAR desta mensagem só roda
 * depois da resposta.
 */
export function tipoCitado(texto: string): string | undefined {
  const t = semAcento(texto);
  if (/\b(casamento|casar|noiv[ao]s?|bodas)\b/.test(t)) return "casamento";
  if (/\b(15|quinze) anos\b|\bdebutante/.test(t)) return "15_anos";
  if (/\binfantil\b|\bcrianca|\bkids\b/.test(t)) return "infantil";
  return undefined;
}

/** Consultas que o sistema faz sozinho antes do modelo, pela mensagem do cliente. */
export function consultasAutomaticas(nomes: string[], mensagem: string, agora: Date): ChamadaDeFerramenta[] {
  if (!nomes.includes("CONSULTAR_AGENDA")) return [];
  const tipo = tipoCitado(mensagem);
  return datasCitadas(mensagem, agora).map(data => ({
    nome: "CONSULTAR_AGENDA",
    // `_tipo` é reserva: vale só quando o cadastro ainda não tem o tipo.
    args: tipo ? { data, _tipo: tipo } : { data }
  }));
}

// Palavras inteiras com acento: `\b` do JS não entende "manhã".
const palavra = (alternativas: string) => new RegExp(`(?<!\\p{L})(?:${alternativas})(?!\\p{L})`, "iu");
const DISPONIBILIDADE = palavra("livres?|dispon[ií]ve(?:l|is)|ocupad[ao]s?|lotad[ao]s?|bloquead[ao]s?");
const REFERENCIA_A_DATA = new RegExp(
  "\\d{1,2}\\s*\\/\\s*\\d{1,2}|" +
    palavra(
      "datas?|dias?|turnos?|manh[ãa]|tarde|noite|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bados?|domingos?|" +
        "janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro"
    ).source,
  "iu"
);

/** A resposta diz que alguma data/turno está livre ou ocupado? Frase a frase, sem os comandos. */
export function afirmaDisponibilidade(resposta: string): boolean {
  const texto = String(resposta || "").replace(/\[\[[^\]]*\]\]/g, " ");
  return texto
    .split(/(?<=[.!?\n])/)
    .some(frase => DISPONIBILIDADE.test(frase) && REFERENCIA_A_DATA.test(frase));
}

const FERRAMENTAS_DE_AGENDA = ["CONSULTAR_AGENDA", "PRE_RESERVAR"];

export const COBRANCA_DE_CONSULTA =
  "[SISTEMA] Sua resposta diz que uma data está livre ou ocupada, mas a agenda NÃO foi consultada nesta resposta — " +
  "isso não pode ir para o cliente. Se o cliente citou uma data ou um mês, escreva SÓ o comando " +
  '[[CONSULTAR_AGENDA data="dd/mm/aaaa"]] (ou mes="mm/aaaa"). ' +
  "Se não citou, reescreva a resposta sem dizer se alguma data está livre ou ocupada.";

/** Texto que devolve a resposta ao modelo, ou `null` quando ela pode seguir. */
export function cobrancaDeConsulta(nomes: string[], resposta: string, executadas: string[]): string | null {
  if (!nomes.includes("CONSULTAR_AGENDA")) return null;
  if (executadas.some(n => FERRAMENTAS_DE_AGENDA.includes(n))) return null;
  return afirmaDisponibilidade(resposta) ? COBRANCA_DE_CONSULTA : null;
}
