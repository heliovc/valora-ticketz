/**
 * Dois robôs não param de conversar sozinhos (Hélio, 06/11/2026: a Val Saúde e
 * a Bella, da Clínica Valim, ficaram trocando agradecimentos). Regras puras:
 * recebem as mensagens da conversa, em ordem, e dizem por que o nosso bot deve
 * ficar calado.
 *
 * Ficar calado não perde o lead: a mensagem continua no CRM, os follow-ups
 * seguem e pergunta ou pedido reabre a conversa. Na dúvida o bot responde:
 * cada regra só cala quando a mensagem é claramente fim de papo.
 */

export type MotivoDoLoop =
  | "so_cortesia"
  | "conversa_encerrada"
  | "mensagem_repetida"
  | "possivel_loop_de_robos";

export interface MensagemDoLoop {
  fromMe: boolean;
  body?: string | null;
  mediaType?: string | null;
  sentBy?: string | null;
  createdAt: Date | string;
}

/** Quantas mensagens a análise lê. Cobre as trocas rápidas com folga. */
export const MENSAGENS_PARA_ANALISE = 30;

/** Trocas seguidas em que o contato responde em até `SEGUNDOS_TROCA_RAPIDA`. */
export const TROCAS_RAPIDAS_MAX = 8;
export const SEGUNDOS_TROCA_RAPIDA = 60;

/** "sim" e "oi" repetem de verdade; só texto longo repetido é resposta pronta. */
const TAMANHO_MINIMO_REPETIDA = 20;

const MIDIA = /audio|ptt|image|video|document|sticker|application/i;

const SAUDACAO_PURA =
  /^(oi|ola|opa|bom dia|boa tarde|boa noite)( (oi|ola|bom dia|boa tarde|boa noite))*( tudo bem| tudo bom| como vai)?$/;

const CORTESIA = new RegExp(
  [
    "obrigad[oa]s?",
    "brigad[oa]s?",
    "obg",
    "agradec\\w*",
    "valeu",
    "vlw",
    "por nada",
    "de nada",
    "disponha",
    "imagina",
    "((fico|ficamos|estou|estamos|sigo|seguimos) )?(a|as) (sua |vossa )?(disposicao|ordens)",
    "(tenha|tenham|desejo|desejamos|desejando)",
    "(otim\\w+|excelente|lind\\w+|maravilhos\\w+|bom|boa) (dia|tarde|noite|semana|fim de semana|final de semana)",
    "ate (mais|logo|breve|a proxima|amanha|depois)",
    "tchau",
    "abracos?",
    "abs",
    "atenciosamente",
    "att"
  ]
    .map(p => `\\b${p}\\b`)
    .join("|"),
  "g"
);

/** Palavras que sobram de uma cortesia e não mudam o sentido dela. */
const ENCHIMENTO = new Set(
  (
    "a o as os e eu nos voce voces tambem muito muita mesmo viu ta tudo que " +
    "pelo pela pelos pelas seu sua um uma por aqui para pra sempre ai entao " +
    "contato atencao disponibilidade retorno mensagem informacao informacoes " +
    "apresentacao proposta equipe"
  ).split(" ")
);

const CONFIRMACAO =
  /^(ok|okay|okey|blz|beleza|certo|entendi|entendido|perfeito|combinado|ta bom|ta certo|show|otimo|joia|tranquilo|pode deixar)( (obrigad[oa]s?|valeu))?$/;

const NEGACAO =
  /\bnao (\w+ )?(quero|queremos|tenho|temos|gostaria|gostariamos|preciso|precisamos)\b/;

const INTERESSE = new RegExp(
  [
    "quero",
    "queremos",
    "queria",
    "queriamos",
    "gostaria",
    "gostariamos",
    "tenho interesse",
    "temos interesse",
    "me interessa",
    "nos interessa",
    "estou interessad[oa]",
    "estamos interessad[oa]s",
    "como funciona",
    "quanto custa",
    "valor(es)?",
    "precos?",
    "taxas?",
    "demonstracao",
    "demo",
    "agendar",
    "marcar",
    "reuniao",
    "mudei de ideia",
    "mudamos de ideia",
    "pensando bem",
    "(pode|podem|poderia|poderiam) (me |nos )?(mandar|enviar|explicar|mostrar|ligar|passar)",
    "me (manda|envia|explica|mostra|liga|chama|passa)"
  ]
    .map(p => `\\b${p}\\b`)
    .join("|")
);

/** Minúsculas, sem acento, emoji nem pontuação. */
function normalizar(texto: string | null | undefined): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const temPergunta = (texto: string | null | undefined): boolean =>
  String(texto || "").includes("?");

/** Só agradecimento ou despedida. "Bom dia" sozinho é saudação, não despedida. */
export function ehSoCortesia(texto: string | null | undefined): boolean {
  if (temPergunta(texto)) return false;
  const t = normalizar(texto);
  if (!t || SAUDACAO_PURA.test(t)) return false;
  const semCortesia = t.replace(CORTESIA, " ");
  if (semCortesia === t) return false;
  return semCortesia
    .split(/\s+/)
    .filter(Boolean)
    .every(p => ENCHIMENTO.has(p));
}

/** "Ok", "certo", "👍". Depois de uma pergunta nossa isso é resposta, não fim de papo. */
export function ehSoConfirmacao(texto: string | null | undefined): boolean {
  if (temPergunta(texto)) return false;
  const bruto = String(texto || "").trim();
  if (!bruto) return false;
  const t = normalizar(bruto);
  return !t || CONFIRMACAO.test(t);
}

/** Depois de "sem interesse", só pergunta ou pedido claro reabre a conversa. */
export function reabreConversa(texto: string | null | undefined): boolean {
  if (temPergunta(texto)) return true;
  const t = normalizar(texto);
  if (NEGACAO.test(t)) return false;
  return INTERESSE.test(t);
}

/** Fala do bot. Disparo do funil e mensagem de pessoa não contam. */
function ehFalaDoBot(m: MensagemDoLoop): boolean {
  return m.fromMe && m.sentBy !== "automacao" && m.sentBy !== "humano";
}

const instante = (m: MensagemDoLoop): number => new Date(m.createdAt).getTime();

/**
 * Trocas seguidas, da mais nova para trás, em que o contato respondeu rápido.
 * Na troca atual vale a mensagem MAIS NOVA do contato: depois que o bot calou,
 * quem escreve horas mais tarde quebra a sequência e é atendido.
 */
export function trocasRapidasSeguidas(mensagens: MensagemDoLoop[]): number {
  let trocas = 0;
  let i = mensagens.length - 1;
  while (i >= 0) {
    const ultimaDoContato = mensagens[i];
    let primeiraDoContato: MensagemDoLoop | null = null;
    while (i >= 0 && !mensagens[i].fromMe) {
      primeiraDoContato = mensagens[i];
      i -= 1;
    }
    if (!primeiraDoContato || i < 0 || !ehFalaDoBot(mensagens[i])) break;
    const resposta = trocas === 0 ? ultimaDoContato : primeiraDoContato;
    const segundos = (instante(resposta) - instante(mensagens[i])) / 1000;
    if (segundos > SEGUNDOS_TROCA_RAPIDA) break;
    trocas += 1;
    while (i >= 0 && mensagens[i].fromMe) i -= 1;
  }
  return trocas;
}

/**
 * Por que o bot não deve responder o que chegou desde a última fala nossa.
 * `null` = pode responder. A primeira resposta da conversa sempre passa: quem
 * só agradeceu o disparo recebe uma resposta, e a próxima cortesia encerra.
 */
export function motivoDoLoop(
  mensagens: MensagemDoLoop[],
  etapa?: string | null
): MotivoDoLoop | null {
  let corte = mensagens.length;
  while (corte > 0 && !mensagens[corte - 1].fromMe) corte -= 1;
  const pendentes = mensagens.slice(corte);
  const anteriores = mensagens.slice(0, corte);
  if (!pendentes.length || !anteriores.some(ehFalaDoBot)) return null;

  const ultimaNossa = anteriores[anteriores.length - 1];
  const temMidia = pendentes.some(m => MIDIA.test(m.mediaType || ""));
  const texto = pendentes
    .map(m => (m.body || "").trim())
    .filter(Boolean)
    .join("\n");

  if (texto && !temMidia) {
    if (ehSoCortesia(texto)) return "so_cortesia";
    if (ehSoConfirmacao(texto) && !temPergunta(ultimaNossa.body)) return "so_cortesia";
    if (
      etapa === "sem_interesse" &&
      ehFalaDoBot(ultimaNossa) &&
      !temPergunta(ultimaNossa.body) &&
      !reabreConversa(texto)
    ) {
      return "conversa_encerrada";
    }
    const jaRecebidas = new Set(
      anteriores.filter(m => !m.fromMe).map(m => normalizar(m.body))
    );
    const repetida = pendentes.every(m => {
      const t = normalizar(m.body);
      return t.length >= TAMANHO_MINIMO_REPETIDA && jaRecebidas.has(t);
    });
    if (repetida) return "mensagem_repetida";
  }

  return trocasRapidasSeguidas(mensagens) >= TROCAS_RAPIDAS_MAX
    ? "possivel_loop_de_robos"
    : null;
}
