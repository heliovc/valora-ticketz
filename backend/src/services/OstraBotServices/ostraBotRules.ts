/**
 * Regras puras do assistente do grupo Ostra Carioca.
 *
 * Nada aqui fala com WhatsApp, banco ou API: são as decisões que precisam
 * estar certas sempre (o que é gatilho, o que é comando do Hélio, quando pode
 * postar no grupo) e por isso ficam isoladas e testadas.
 */

export const FUSO = "America/Sao_Paulo";
export const PREFIXO_GRUPO = "🤖 ";
/** Marca invisível nas mensagens que o próprio bot escreve no chat do Hélio. */
export const MARCA_DO_BOT = "‎";
export const MAX_LINHAS = 4;
export const HORA_ABRE = 8;
export const HORA_FECHA = 21;
export const VALIDADE_RASCUNHO_MS = 2 * 60 * 60 * 1000;

/**
 * "Claude, quanto fica…" → "quanto fica…". Devolve `null` quando o texto não
 * começa com a palavra Claude (sozinha, não "Claudete").
 */
export const extrairPergunta = (
  texto: string | null | undefined
): string | null => {
  if (!texto) return null;
  const m = texto.trim().match(/^claude(?![\p{L}\p{N}])[\s,:;.!?-]*(.*)$/isu);
  if (!m) return null;
  const pergunta = m[1].trim();
  return pergunta.length > 0 ? pergunta : null;
};

export type ComandoDoHelio =
  | { tipo: "ok"; id: number }
  | { tipo: "nao"; id: number }
  | { tipo: "editar"; id: number; texto: string };

/** "ok 12", "não 12", "nao #12", "editar 12 novo texto". */
export const interpretarComando = (
  texto: string | null | undefined
): ComandoDoHelio | null => {
  if (!texto) return null;
  const t = texto.trim();

  const ok = t.match(/^ok\s+#?(\d+)\s*$/i);
  if (ok) return { tipo: "ok", id: Number(ok[1]) };

  const nao = t.match(/^n[aã]o\s+#?(\d+)\s*$/i);
  if (nao) return { tipo: "nao", id: Number(nao[1]) };

  const editar = t.match(/^editar\s+#?(\d+)\s+([\s\S]+)$/i);
  if (editar) {
    const novo = editar[2].trim();
    if (novo) return { tipo: "editar", id: Number(editar[1]), texto: novo };
  }
  return null;
};

/** Hora e minuto em Brasília, sem depender do fuso da máquina. */
const horaEmBrasilia = (agora: Date): { hora: number; minuto: number } => {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(agora);
  const hora = Number(partes.find(p => p.type === "hour")?.value);
  const minuto = Number(partes.find(p => p.type === "minute")?.value);
  return { hora, minuto };
};

/** Pode postar no grupo agora? Das 8h às 21h (21h00 já fechado). */
export const dentroDoHorario = (agora: Date): boolean => {
  const { hora } = horaEmBrasilia(agora);
  return hora >= HORA_ABRE && hora < HORA_FECHA;
};

/**
 * Próximo instante em que o grupo pode receber mensagem. Dentro do horário é
 * o próprio `agora`. Brasília não tem horário de verão desde 2019, então o
 * deslocamento fixo de -3h é seguro.
 */
export const proximaAbertura = (agora: Date): Date => {
  if (dentroDoHorario(agora)) return agora;
  const { hora } = horaEmBrasilia(agora);
  const local = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const alvo = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + (hora >= HORA_FECHA ? 1 : 0),
      HORA_ABRE + 3,
      0,
      0
    )
  );
  return alvo;
};

/**
 * Prazo para o Hélio responder ao rascunho: 2h contadas a partir de quando o
 * grupo pode receber a mensagem. Pergunta feita às 23h não expira de
 * madrugada: espera até as 10h.
 */
export const prazoDoRascunho = (criadoEm: Date): Date =>
  new Date(proximaAbertura(criadoEm).getTime() + VALIDADE_RASCUNHO_MS);

/**
 * Texto final do grupo: no máximo 4 linhas não vazias, com o prefixo do
 * assistente uma única vez.
 */
export const formatarParaOGrupo = (texto: string): string => {
  const linhas = texto
    .replace(/\r/g, "")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINHAS);
  const corpo = linhas.join("\n").replace(/^🤖\s*/u, "");
  return `${PREFIXO_GRUPO}${corpo}`;
};

export const formatarRascunhoParaOHelio = (p: {
  id: number;
  autor: string;
  pergunta: string;
  rascunho: string;
  foraDoHorario: boolean;
}): string => {
  const aviso = p.foraDoHorario
    ? "\n(Fora do horário: se aprovar agora, sai às 8h.)"
    : "";
  return (
    `${MARCA_DO_BOT}#${p.id} Pedido de ${p.autor}: "${p.pergunta}"\n` +
    `Rascunho: ${p.rascunho}\n` +
    `Responda "ok ${p.id}" para enviar, "não ${p.id}" para descartar ou ` +
    `"editar ${p.id} <texto>" para trocar o texto.${aviso}`
  );
};

/** Como uma mensagem do grupo aparece no histórico que vai para o modelo. */
export const descreverMidia = (p: {
  tipo: string;
  nomeArquivo?: string | null;
  legenda?: string | null;
}): string => {
  const legenda = p.legenda ? ` ${p.legenda}` : "";
  switch (p.tipo) {
    case "imageMessage":
      return `[foto]${legenda}`;
    case "audioMessage":
    case "voiceMessage":
    case "pttMessage":
      return "[áudio]";
    case "videoMessage":
      return `[vídeo]${legenda}`;
    case "stickerMessage":
      return "[figurinha]";
    case "documentMessage":
    case "documentWithCaptionMessage": {
      const nome = p.nomeArquivo || "documento";
      const rotulo = /\.pdf$/i.test(nome) ? "PDF" : "arquivo";
      return `[${rotulo}: ${nome}]${legenda}`;
    }
    case "locationMessage":
    case "liveLocationMessage":
      return "[localização]";
    case "contactMessage":
      return "[contato]";
    default:
      return `[${p.tipo}]`;
  }
};
