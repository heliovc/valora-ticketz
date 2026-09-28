import type { BotTurn } from "./aiBot";

/**
 * Regras de turno do bot de IA — o que decide QUANDO e SOBRE O QUÊ ele responde.
 *
 * Nasceu de uma conversa real (28/09/2026): o cliente mandou "Oi" e, segundos
 * depois, "Boa tarde tudo bem". O bot respondeu as duas separadamente, se
 * apresentou duas vezes e deu "bom dia" às 14h57. Três defeitos, três regras:
 * agrupar a rajada, saber a hora de Brasília e não se reapresentar.
 *
 * Funções puras (menos `agruparRajada`, que só guarda timers), testadas sem banco.
 */

const FUSO = "America/Sao_Paulo";

/** Tempo de espera por mais mensagens antes de responder a rajada. */
export const AGRUPAR_MS = Number(process.env.AI_BOT_AGRUPAR_MS || 7000);

/** Hora e minuto em Brasília, independente do fuso do servidor. */
function horaDeBrasilia(agora: Date): { hora: number; minuto: number } {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(agora);
  const valor = (tipo: string) =>
    Number(partes.find(p => p.type === tipo)?.value || 0);
  return { hora: valor("hour"), minuto: valor("minute") };
}

/** "bom dia" até 11h59, "boa tarde" até 17h59, "boa noite" no resto. */
export function saudacaoDoPeriodo(agora: Date): string {
  const { hora } = horaDeBrasilia(agora);
  if (hora >= 5 && hora < 12) return "bom dia";
  if (hora >= 12 && hora < 18) return "boa tarde";
  return "boa noite";
}

/** Ex.: "segunda-feira, 28/09/2026, 14:57". */
export function momentoPorExtenso(agora: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(agora);
}

/**
 * Nome do contato pronto para o bot usar. O WhatsApp entrega o nome de perfil
 * como a pessoa digitou ("malick"); quando não há nome, entrega o número — e
 * "Olá, 5521978901233!" é pior que não chamar pelo nome.
 */
export function nomeParaOBot(
  nome: string | undefined | null
): string | undefined {
  const limpo = (nome || "").trim();
  if (!limpo || !/\p{L}/u.test(limpo)) return undefined;
  return limpo
    .toLocaleLowerCase("pt-BR")
    .replace(
      /(^|[\s'-])(\p{L})/gu,
      (_m, sep: string, letra: string) => sep + letra.toLocaleUpperCase("pt-BR")
    );
}

/** Já existe fala do bot (ou de atendente) na conversa? */
export function jaSeApresentou(history: BotTurn[]): boolean {
  return history.some(turn => turn.role === "assistant");
}

type MensagemGravada = { fromMe: boolean; body?: string | null };

/**
 * Separa o que o cliente mandou desde a última fala nossa (o turno a
 * responder) do histórico anterior. Várias mensagens seguidas viram uma só,
 * uma por linha — é assim que se responde a "Oi" + "Boa tarde tudo bem" de
 * uma vez. `pendente` vazio significa que não há nada novo a responder.
 */
export function separarTurnoAtual(mensagens: MensagemGravada[]): {
  history: BotTurn[];
  pendente: string;
} {
  const comTexto = mensagens.filter(m => m.body && m.body.trim());
  let corte = comTexto.length;
  while (corte > 0 && !comTexto[corte - 1].fromMe) corte -= 1;

  const history = comTexto.slice(0, corte).map(
    (m): BotTurn => ({
      role: m.fromMe ? "assistant" : "user",
      text: (m.body || "").trim()
    })
  );
  const pendente = comTexto
    .slice(corte)
    .map(m => (m.body || "").trim())
    .join("\n");

  return { history, pendente };
}

const rajadas = new Map<number, NodeJS.Timeout>();

/**
 * Adia a resposta do ticket até o cliente parar de digitar. Cada mensagem nova
 * da mesma conversa reinicia a espera; só a última dispara `responder`, que
 * lê do banco tudo o que chegou no intervalo.
 */
export function agruparRajada(
  ticketId: number,
  responder: () => Promise<void>,
  esperaMs: number = AGRUPAR_MS
): void {
  const anterior = rajadas.get(ticketId);
  if (anterior) clearTimeout(anterior);

  const timer = setTimeout(() => {
    rajadas.delete(ticketId);
    responder().catch(() => undefined);
  }, esperaMs);
  rajadas.set(ticketId, timer);
}
