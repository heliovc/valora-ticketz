import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { logger } from "../utils/logger";

/**
 * Helper de geração de respostas do bot de IA (Valora).
 *
 * Dois provedores, mesma interface:
 * - **Anthropic** (`ANTHROPIC_API_KEY`) — Claude Haiku, qualidade de referência.
 * - **Gemini** (`GEMINI_API_KEY`) — camada gratuita do Google, usada quando não
 *   há crédito de API na Anthropic. Chamado por HTTP direto (sem SDK novo).
 *
 * Escolha por `AI_BOT_PROVIDER` (`anthropic` | `gemini`). Sem essa variável,
 * vale a primeira chave presente, nessa ordem. **Ter as duas chaves e não
 * declarar o provedor mantém a Anthropic** — inclusive quando ela está sem
 * crédito, que é falha de conta e não motivo para trocar de modelo sozinho.
 *
 * A persona e a base de conhecimento são configuradas por lojista (Company) e
 * entram no system prompt — com prompt caching no prefixo estável (Anthropic)
 * para baratear conversas.
 *
 * Handoff: quando o modelo julgar que deve passar para um humano (cliente
 * pediu atendente, ou não é seguro responder), ele responde APENAS com o
 * token `HANDOFF_TOKEN`. Nesse caso `generateBotReply` devolve
 * `{ kind: "handoff" }` com uma mensagem de espera — o cliente PRECISA
 * receber alguma coisa, senão fica no vácuo achando que ninguém viu. O
 * chamador envia esse texto e deixa o ticket para atendimento humano.
 */

type Provider = "anthropic" | "gemini";

const ANTHROPIC_MODEL = process.env.AI_BOT_MODEL || "claude-haiku-4-5";
/**
 * `gemini-2.5-flash` e não o `-latest`: medido do servidor de produção, este
 * responde em ~0,5s, enquanto o apontado como mais novo alternou 503, 429 de
 * cota e uma resposta de 27s. Camada gratuita: o modelo da moda é o mais
 * disputado, e atendimento não pode esperar.
 */
const GEMINI_MODEL = process.env.AI_BOT_GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_BASE =
  process.env.AI_BOT_GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
/**
 * O Gemini "pensa" antes de responder, o que num atendimento só gasta tempo e
 * cota. `0` desliga (`thinkingBudget`), que é o que a família 2.5 aceita; os
 * modelos 3 querem palavra (`low`/`high`, em `thinkingLevel`) e devolvem 400
 * para o outro formato. Daí o campo aceitar número, palavra ou `off`.
 */
const GEMINI_THINKING = (process.env.AI_BOT_GEMINI_THINKING || "0").trim().toLowerCase();
/** O visitante está esperando no widget: melhor errar por cortar cedo. */
const GEMINI_TIMEOUT_MS = Number(process.env.AI_BOT_GEMINI_TIMEOUT_MS || 15000);
/**
 * A camada gratuita recusa por fila (503) e por cota de minuto (429), e volta
 * em seguida. Sem isso, um pico momentâneo vira "o bot parou de responder".
 */
const GEMINI_RETRY_DELAYS_MS = [800, 2500];
const GEMINI_RETRY_STATUS = [429, 500, 503];

const MAX_TOKENS = Number(process.env.AI_BOT_MAX_TOKENS || 600);
const HANDOFF_TOKEN = "__HUMANO__";

/**
 * O que o cliente recebe quando o bot sai de cena. Silêncio aqui é o pior
 * desfecho possível — principalmente em conversa vinda de anúncio, onde a
 * pessoa acabou de chegar e ainda não sabe se o canal está vivo.
 */
const HANDOFF_MESSAGE =
  process.env.AI_BOT_HANDOFF_MESSAGE ||
  "Só um momento, por favor — vou chamar uma pessoa do nosso time para falar com você.";

export type BotTurn = { role: "user" | "assistant"; text: string };

/** Arquivo de consulta do lojista, já com o texto extraído. */
export type BotFile = { name: string; text: string };

/**
 * Teto do conjunto de arquivos dentro do prompt. Cada arquivo já vem cortado
 * na extração; este é o limite da soma, porque dez arquivos no teto individual
 * estourariam a janela e encareceriam toda conversa da conta.
 */
const MAX_CHARS_ARQUIVOS = 40000;

/** Resultado de uma rodada do bot. `text` nunca vem vazio. */
export type BotReply = {
  /** `reply`: resposta do bot. `handoff`: avisa e passa para humano. */
  kind: "reply" | "handoff";
  text: string;
};

export type GenerateBotReplyParams = {
  /** Persona / instruções do lojista (tom, papel, regras). */
  persona: string;
  /** Base de conhecimento em texto (FAQ, produtos, preços, políticas). */
  knowledge?: string;
  /** Histórico recente da conversa, do mais antigo ao mais recente. */
  history: BotTurn[];
  /** Mensagem atual recebida do cliente. */
  userMessage: string;
  /** Nome do contato, quando disponível (para personalizar). */
  contactName?: string;
  /** Arquivos de consulta da empresa (lista de preços, catálogo, FAQ). */
  files?: BotFile[];
};

let client: Anthropic | null = null;

/** Cliente Anthropic singleton; `null` quando a chave central não está configurada. */
function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Provedor em uso, ou `null` quando nenhuma chave está configurada. */
function resolveProvider(): Provider | null {
  const escolhido = (process.env.AI_BOT_PROVIDER || "").trim().toLowerCase();
  if (escolhido === "gemini") {
    return process.env.GEMINI_API_KEY ? "gemini" : null;
  }
  if (escolhido === "anthropic") {
    return process.env.ANTHROPIC_API_KEY ? "anthropic" : null;
  }
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

/** Indica se o bot de IA pode operar (alguma chave presente). */
export function isAiBotAvailable(): boolean {
  return resolveProvider() !== null;
}

/**
 * Junta os arquivos de consulta num bloco só, respeitando o teto da soma.
 * O arquivo que não couber inteiro é cortado, e o corte fica dito no texto —
 * calar isso faria o modelo tratar uma tabela pela metade como se fosse a
 * tabela completa, e responder "não temos" para item que existe.
 */
function buildFilesBlock(files: BotFile[]): string {
  const partes: string[] = [];
  let usado = 0;

  for (const file of files) {
    if (usado >= MAX_CHARS_ARQUIVOS) break;
    const restante = MAX_CHARS_ARQUIVOS - usado;
    const texto = file.text.trim();
    if (!texto) continue;

    const cabe = texto.length <= restante;
    const corpo = cabe
      ? texto
      : `${texto.slice(0, restante)}\n[...este arquivo foi cortado por tamanho; pode haver itens não listados aqui...]`;

    partes.push(`--- Arquivo: ${file.name} ---\n${corpo}`);
    usado += corpo.length;
  }

  return partes.join("\n\n");
}

function buildSystemPrompt(
  persona: string,
  knowledge: string | undefined,
  contactName: string | undefined,
  files: BotFile[] | undefined
): string {
  const parts: string[] = [];
  parts.push(
    persona?.trim() ||
      "Você é um assistente virtual de atendimento e vendas no WhatsApp de uma empresa brasileira."
  );
  parts.push(
    [
      "Diretrizes gerais:",
      "- Responda em português do Brasil, com mensagens curtas e cordiais, adequadas ao WhatsApp.",
      "- Use SOMENTE as informações da base de conhecimento abaixo. Nunca invente preços, prazos, políticas ou dados que não estejam nela.",
      "- Não prometa nada que dependa de aprovação humana sem deixar claro que será confirmado.",
      `- Se o cliente pedir para falar com um humano/atendente, ou se você não tiver informação segura para responder, responda APENAS com o token exato ${HANDOFF_TOKEN} e nada mais.`,
      contactName ? `- O cliente se chama ${contactName}.` : ""
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (knowledge && knowledge.trim()) {
    parts.push(`Base de conhecimento:\n${knowledge.trim()}`);
  }
  if (files && files.length) {
    const bloco = buildFilesBlock(files);
    if (bloco) {
      parts.push(
        [
          "Arquivos de consulta enviados pela empresa. Valem como base de conhecimento:",
          "- Consulte-os para responder preço, item de catálogo, prazo e condição.",
          "- Se o cliente perguntar por um item que não está neles, diga que vai confirmar. Não deduza preço de item parecido.",
          "",
          bloco
        ].join("\n")
      );
    }
  }
  return parts.join("\n\n");
}

/**
 * Turnos da conversa, do mais antigo ao mais recente, já com a mensagem atual
 * no fim. Um histórico que começa por fala do bot é cortado no início: os dois
 * provedores esperam a conversa abrindo pelo cliente.
 */
function buildTurns(params: GenerateBotReplyParams): BotTurn[] {
  const history = [...params.history];
  while (history.length && history[0].role === "assistant") {
    history.shift();
  }
  return [...history, { role: "user", text: params.userMessage }];
}

/** Chamada à Anthropic. Devolve o texto puro; erro sobe para o chamador. */
async function callAnthropic(systemText: string, turns: BotTurn[]): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return "";

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS,
    // Prefixo estável (persona + base) cacheado para baratear conversas.
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages: turns.map(
      (turn): Anthropic.MessageParam => ({
        role: turn.role,
        content: turn.text
      })
    )
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("")
    .trim();
}

/**
 * POST ao Gemini, repetindo só o que a camada gratuita costuma devolver em
 * pico (fila e cota). Erro de chave ou de payload não se repete: seria gastar
 * o tempo do visitante para receber o mesmo 400.
 */
async function postComRetentativa(corpo: unknown, apiKey: string): Promise<any> {
  const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent`;
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= GEMINI_RETRY_DELAYS_MS.length; tentativa += 1) {
    try {
      const { data } = await axios.post(url, corpo, {
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        timeout: GEMINI_TIMEOUT_MS
      });
      return data;
    } catch (err) {
      ultimoErro = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const vaiRepetir =
        tentativa < GEMINI_RETRY_DELAYS_MS.length &&
        status !== undefined &&
        GEMINI_RETRY_STATUS.includes(status);
      if (!vaiRepetir) throw err;
      logger.warn({ status, tentativa: tentativa + 1 }, "[aiBot] Gemini recusou; repetindo");
      await new Promise(r => setTimeout(r, GEMINI_RETRY_DELAYS_MS[tentativa]));
    }
  }

  throw ultimoErro;
}

/**
 * Chamada ao Gemini (REST, `generateContent`). A chave vai no cabeçalho
 * `X-goog-api-key` — nunca na URL, que é o que aparece em log de proxy.
 */
async function callGemini(systemText: string, turns: BotTurn[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "";

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: MAX_TOKENS,
    temperature: 0.4
  };
  if (GEMINI_THINKING && GEMINI_THINKING !== "off") {
    const orcamento = Number(GEMINI_THINKING);
    generationConfig.thinkingConfig = Number.isFinite(orcamento)
      ? { thinkingBudget: orcamento }
      : { thinkingLevel: GEMINI_THINKING };
  }

  const corpo = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents: turns.map(turn => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.text }]
    })),
    generationConfig
  };

  const data = await postComRetentativa(corpo, apiKey);

  // Resposta barrada por filtro de conteúdo não traz candidato: vira handoff
  // lá em cima, como qualquer resposta vazia.
  const blocked = data?.promptFeedback?.blockReason;
  if (blocked) {
    logger.warn({ blocked }, "[aiBot] Gemini barrou o prompt");
    return "";
  }

  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part: { text?: string }) => part?.text || "")
    .join("")
    .trim();
}

/**
 * Gera a resposta do bot.
 *
 * - `kind: "reply"` — texto do bot, enviar normalmente.
 * - `kind: "handoff"` — enviar `text` (mensagem de espera) e deixar o ticket
 *   para atendimento humano. Cobre o token de handoff, a resposta vazia e a
 *   falha na chamada ao modelo: em todos, o cliente recebe alguma coisa.
 * - `null` — nenhuma chave configurada. É erro de implantação, e não evento
 *   de conversa: fica em silêncio e sai no log.
 */
export const generateBotReply = async (
  params: GenerateBotReplyParams
): Promise<BotReply | null> => {
  const provider = resolveProvider();
  if (!provider) {
    logger.warn("[aiBot] sem ANTHROPIC_API_KEY nem GEMINI_API_KEY — bot de IA desabilitado");
    return null;
  }

  const systemText = buildSystemPrompt(
    params.persona,
    params.knowledge,
    params.contactName,
    params.files
  );
  const turns = buildTurns(params);

  try {
    const text =
      provider === "gemini"
        ? await callGemini(systemText, turns)
        : await callAnthropic(systemText, turns);

    if (!text || text.includes(HANDOFF_TOKEN)) {
      return { kind: "handoff", text: HANDOFF_MESSAGE };
    }

    return { kind: "reply", text };
  } catch (err) {
    // O corpo da resposta é o que diz a causa real (sem crédito, cota estourada,
    // chave inválida). Sem ele, o log só mostra "400" e a investigação começa
    // do zero — foi o que aconteceu quando o crédito da Anthropic acabou.
    const detalhe = axios.isAxiosError(err) ? err.response?.data : undefined;
    logger.error({ err, provider, detalhe }, "[aiBot] falha ao gerar resposta do bot");
    return { kind: "handoff", text: HANDOFF_MESSAGE };
  }
};
