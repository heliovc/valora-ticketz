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
 * Período aberto citado na mensagem (10/11/2026: "15 anos, na semana que vem"
 * — o bot pediu a data exata duas vezes). Vira uma consulta do período: o
 * bot recebe os dias livres e oferece. Só entra quando não há data exata.
 *   - "semana que vem" / "próxima semana" → segunda a domingo da semana seguinte
 *   - "essa semana" → de amanhã até domingo
 *   - "esse fim de semana" / "próximo fim de semana" → a sexta, o sábado e o domingo que vêm
 *   - "fim de semana que vem" → sexta a domingo da semana seguinte
 *   - "mês que vem" / "esse mês" / "em março (de 2027)" → o mês inteiro
 */
export function periodoCitado(
  texto: string,
  agora: Date
): { de: string; ate: string } | { mes: string } | null {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: FUSO });
  const [anoHoje, mesHoje, diaHoje] = hoje.split("-").map(Number);
  const base = new Date(Date.UTC(anoHoje, mesHoje - 1, diaHoje));
  const dow = base.getUTCDay(); // 0 domingo … 6 sábado
  const somar = (dias: number) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + dias);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  };
  const t = semAcento(texto);
  const ateSegunda = (8 - dow) % 7 || 7; // dias até a próxima segunda
  const ateSexta = (5 - dow + 7) % 7; // 0 = hoje é sexta

  if (/\b(fim|final) de semana que vem\b|\bfds que vem\b/.test(t)) {
    return { de: somar(ateSegunda + 4), ate: somar(ateSegunda + 6) };
  }
  if (/\b(esse|este|nesse|neste|proximo|no proximo|agora no) (fim|final) de semana\b|\bfds\b/.test(t)) {
    // Sábado ou domingo hoje: o que sobra deste fim de semana conta como "esse".
    if (dow === 6) return { de: somar(0), ate: somar(1) };
    if (dow === 0) return { de: somar(0), ate: somar(0) };
    return { de: somar(ateSexta), ate: somar(ateSexta + 2) };
  }
  if (/\b(semana que vem|proxima semana|semana seguinte)\b/.test(t)) {
    return { de: somar(ateSegunda), ate: somar(ateSegunda + 6) };
  }
  if (/\b(essa|esta|nessa|nesta) semana\b/.test(t)) {
    const ateDomingo = (7 - dow) % 7;
    return ateDomingo ? { de: somar(1), ate: somar(ateDomingo) } : { de: somar(ateSegunda), ate: somar(ateSegunda + 6) };
  }
  if (/\b(mes que vem|proximo mes)\b/.test(t)) {
    const m = mesHoje === 12 ? 1 : mesHoje + 1;
    return { mes: `${pad(m)}/${mesHoje === 12 ? anoHoje + 1 : anoHoje}` };
  }
  if (/\b(esse|este|nesse|neste) mes\b/.test(t)) return { mes: `${pad(mesHoje)}/${anoHoje}` };
  const nome = new RegExp(`(?<!\\p{L})(${MESES.join("|")})(?!\\p{L})(?:\\s+(?:de|do)\\s+(\\d{4}|ano que vem|proximo ano))?`, "u").exec(t);
  if (nome) {
    const m = MESES.indexOf(nome[1]) + 1;
    let ano = m < mesHoje ? anoHoje + 1 : anoHoje;
    if (nome[2]) ano = /^\d{4}$/.test(nome[2]) ? Number(nome[2]) : anoHoje + 1;
    if (ano < anoHoje || ano > anoHoje + ANOS_A_FRENTE || (ano === anoHoje && m < mesHoje)) return null;
    return { mes: `${pad(m)}/${ano}` };
  }
  return null;
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
  // `_tipo` é reserva: vale só quando o cadastro ainda não tem o tipo.
  const comTipo = (args: Record<string, string>) => (tipo ? { ...args, _tipo: tipo } : args);
  const datas = datasCitadas(mensagem, agora);
  if (datas.length) return datas.map(data => ({ nome: "CONSULTAR_AGENDA", args: comTipo({ data }) }));
  const periodo = periodoCitado(mensagem, agora);
  return periodo ? [{ nome: "CONSULTAR_AGENDA", args: comTipo(periodo) }] : [];
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

/**
 * O cliente pediu a proposta (ou os valores) nesta mensagem? Caso real (demo,
 * 11/11/2026): "Quero o sábado. Me manda a proposta com a banda e o open bar" —
 * o bot consultou o sábado e só ofereceu a pré-reserva, sem a proposta.
 */
export function pedeProposta(mensagem: string): boolean {
  const t = semAcento(mensagem);
  // "não precisa da proposta", "sem proposta"
  if (/\b(nao|sem)\s+(\w+\s+){0,2}(a\s+|da\s+|de\s+)?(proposta|orcamento)\b/.test(t)) return false;
  // Quer fechar a que já recebeu: é o COBRAR_SINAL, não outra proposta.
  if (/\b(fechar|fecho|fechamos|aceit\w*|sinal|pix|pag\w*)\b/.test(t)) return false;
  const pedido = "(manda|mande|mandar|envia|envie|enviar|faz|faca|fazer|gera|gere|gerar|monta|monte|montar|passa|passe|passar|quero|queria|gostaria|ver|receber|saber)";
  return new RegExp(`\\b${pedido}\\b[^.?!]{0,40}\\b(proposta|orcamento|valores|precos)\\b`).test(t);
}

export const COBRANCA_DE_PROPOSTA =
  "[SISTEMA] O cliente pediu a proposta nesta mensagem e ela NÃO foi gerada. Escreva SÓ o comando " +
  '[[GERAR_PROPOSTA data="dd/mm/aaaa" pacote="…" extras="…" observacao="…"]] com a data e o pacote que ele escolheu ' +
  "e os itens extras que ele pediu (o que não está na lista vai em observacao). A pré-reserva você oferece depois, junto com o link.";

/** Texto que devolve a resposta ao modelo, ou `null` quando ela pode seguir. */
export function cobrancaDeConsulta(
  nomes: string[],
  resposta: string,
  executadas: string[],
  mensagem = ""
): string | null {
  if (
    nomes.includes("CONSULTAR_AGENDA") &&
    !executadas.some(n => FERRAMENTAS_DE_AGENDA.includes(n)) &&
    afirmaDisponibilidade(resposta)
  ) {
    return COBRANCA_DE_CONSULTA;
  }
  if (
    nomes.includes("GERAR_PROPOSTA") &&
    !executadas.includes("GERAR_PROPOSTA") &&
    !/\/proposta\//.test(resposta) &&
    pedeProposta(mensagem)
  ) {
    return COBRANCA_DE_PROPOSTA;
  }
  return null;
}
