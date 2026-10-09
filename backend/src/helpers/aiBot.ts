import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { logger } from "../utils/logger";
import {
  jaSeApresentou,
  momentoPorExtenso,
  nomeParaOBot,
  saudacaoDoPeriodo
} from "./aiBotTurn";

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
  /**
   * Handoff por FALHA do provedor (cota, rede, chave) — não foi decisão da
   * conversa. Nesse caso o bot não é desligado no card: a próxima mensagem
   * tenta de novo.
   */
  falha?: boolean;
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
  /** Momento da resposta; só os testes passam outro. */
  agora?: Date;
  /**
   * Foco desta conversa (produto/objetivo da lista em que o card está), vindo
   * da configuração da ação "Ligar o Bot de IA". Vazio = sem foco.
   */
  foco?: string;
  /**
   * Modelos DA EMPRESA, na ordem de preferência (CRM → Bot). Cada empresa usa
   * as próprias chaves — nunca a de outra. Vazio = bot indisponível.
   */
  provedores: ProvedorDoBot[];
};

export type NomeDoProvedor = "gemini" | "groq" | "anthropic";

/** Um modelo configurado pela empresa, com a chave já decifrada. */
export type ProvedorDoBot = {
  provider: NomeDoProvedor;
  model: string;
  apiKey: string;
};

/** Modelo sugerido para cada provedor quando a empresa não escolhe. */
export const MODELO_PADRAO: Record<NomeDoProvedor, string> = {
  gemini: "gemini-2.5-flash-lite",
  groq: "llama-3.3-70b-versatile",
  anthropic: "claude-haiku-4-5"
};

const clientesAnthropic = new Map<string, Anthropic>();

/** Um cliente por chave: empresas diferentes nunca compartilham credencial. */
function getClient(apiKey: string): Anthropic {
  let cliente = clientesAnthropic.get(apiKey);
  if (!cliente) {
    cliente = new Anthropic({ apiKey });
    clientesAnthropic.set(apiKey, cliente);
  }
  return cliente;
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

type ContextoDaConversa = {
  contactName?: string;
  agora: Date;
  /** Já houve fala nossa na conversa — não cumprimentar de novo. */
  jaConversou: boolean;
  /** Produto/objetivo desta conversa, configurado na lista. */
  foco?: string;
  /**
   * O que a empresa mandou ANTES de o cliente falar (ex.: modelo do disparo).
   * Vazio = foi o cliente quem começou.
   */
  abertura?: string;
};

/**
 * Falas nossas antes da primeira fala do cliente: a conversa foi iniciada pela
 * empresa (disparo, modelo, nova conversa). Elas saem dos turnos — os
 * provedores exigem que a conversa abra pelo cliente — e por isso precisam
 * chegar ao bot pelo prompt; sem isso o bot recebia "Quero saber mais" sem
 * saber a que o cliente respondia, e agradecia "pelo contato".
 */
export function aberturaDaEmpresa(history: BotTurn[]): string {
  const abertura: string[] = [];
  for (const turno of history) {
    if (turno.role !== "assistant") break;
    if (turno.text && turno.text.trim()) abertura.push(turno.text.trim());
  }
  return abertura.join("\n\n");
}

export function buildSystemPrompt(
  persona: string,
  knowledge: string | undefined,
  files: BotFile[] | undefined,
  contexto: ContextoDaConversa
): string {
  const nome = nomeParaOBot(contexto.contactName);
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
      nome
        ? `- O cliente se chama ${nome}. Escreva o nome assim, com inicial maiúscula.`
        : "",
      `- Agora é ${momentoPorExtenso(contexto.agora)} (horário de Brasília). Se for cumprimentar, diga "${saudacaoDoPeriodo(contexto.agora)}" — nunca outra saudação de período.`,
      "- Quando o cliente manda várias mensagens seguidas, elas chegam juntas, uma por linha. Responda a todas numa resposta só.",
      contexto.jaConversou
        ? "- Você JÁ se apresentou nesta conversa. Não cumprimente de novo, não repita seu nome nem a empresa e não agradeça o contato outra vez: responda direto ao que o cliente acabou de dizer. Estas regras valem mesmo que as instruções acima mandem se apresentar."
        : "- Esta é sua primeira resposta na conversa: apresente-se uma única vez."
    ]
      .filter(Boolean)
      .join("\n")
  );
  if (contexto.abertura && contexto.abertura.trim()) {
    parts.push(
      [
        "Esta conversa foi INICIADA PELA EMPRESA. A empresa enviou esta mensagem ao cliente, e o cliente está respondendo a ela:",
        "<<<",
        contexto.abertura.trim().slice(0, 2000),
        ">>>",
        "- NÃO agradeça pelo contato e NÃO diga que o cliente procurou a empresa: foi a empresa que procurou o cliente.",
        "- NÃO se apresente de novo nem repita o cumprimento: a mensagem acima já apresentou a empresa.",
        "- Continue a partir do que foi enviado, respondendo ao que o cliente disse (ex.: se ele escolheu um botão como \"Quero saber mais\", siga direto para isso)."
      ].join("\n")
    );
  }
  if (contexto.foco && contexto.foco.trim()) {
    parts.push(
      [
        "Foco desta conversa (configurado pela empresa para esta etapa do funil):",
        contexto.foco.trim(),
        "- Concentre a conversa nisso e ofereça só isso, a não ser que o cliente pergunte por outra coisa.",
        "- Preços, condições e regras continuam vindo SOMENTE da base de conhecimento abaixo."
      ].join("\n")
    );
  }
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
export function buildTurns(params: GenerateBotReplyParams): BotTurn[] {
  const history = [...params.history];
  while (history.length && history[0].role === "assistant") {
    history.shift();
  }
  return [...history, { role: "user", text: params.userMessage }];
}

/** Chamada à Anthropic. Devolve o texto puro; erro sobe para o chamador. */
async function callAnthropic(
  systemText: string,
  turns: BotTurn[],
  apiKey: string,
  model: string
): Promise<string> {
  const anthropic = getClient(apiKey);

  const response = await anthropic.messages.create({
    model: model || ANTHROPIC_MODEL,
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
async function postComRetentativa(
  corpo: unknown,
  apiKey: string,
  model: string
): Promise<any> {
  const url = `${GEMINI_API_BASE}/models/${model || GEMINI_MODEL}:generateContent`;
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
      // Cota DIÁRIA estourada não volta em segundos: repetir só atrasa a
      // passagem para o próximo modelo da lista.
      const corpoDoErro = axios.isAxiosError(err) ? JSON.stringify(err.response?.data || "") : "";
      const cotaDoDia = /PerDay/i.test(corpoDoErro);
      const vaiRepetir =
        !cotaDoDia &&
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
async function callGemini(
  systemText: string,
  turns: BotTurn[],
  apiKey: string,
  model: string
): Promise<string> {
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

  const data = await postComRetentativa(corpo, apiKey, model);

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
 * Groq (API compatível com a da OpenAI). Modelo padrão: Llama 3.3 70B.
 */
async function callGroq(
  systemText: string,
  turns: BotTurn[],
  apiKey: string,
  model: string
): Promise<string> {
  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: model || MODELO_PADRAO.groq,
      max_tokens: MAX_TOKENS,
      temperature: 0.4,
      messages: [
        { role: "system", content: systemText },
        ...turns.map(turn => ({ role: turn.role, content: turn.text }))
      ]
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      timeout: GEMINI_TIMEOUT_MS
    }
  );
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

/** Uma chamada ao provedor indicado. Erro sobe — quem chama passa ao próximo. */
export async function chamarProvedor(
  provedor: ProvedorDoBot,
  systemText: string,
  turns: BotTurn[]
): Promise<string> {
  const model = provedor.model || MODELO_PADRAO[provedor.provider];
  if (provedor.provider === "gemini") return callGemini(systemText, turns, provedor.apiKey, model);
  if (provedor.provider === "groq") return callGroq(systemText, turns, provedor.apiKey, model);
  return callAnthropic(systemText, turns, provedor.apiKey, model);
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
  const provedores = (params.provedores || []).filter(p => p.apiKey);
  if (!provedores.length) {
    logger.warn("[aiBot] empresa sem modelo de IA configurado — bot não responde");
    return null;
  }

  const systemText = buildSystemPrompt(
    params.persona,
    params.knowledge,
    params.files,
    {
      contactName: params.contactName,
      agora: params.agora || new Date(),
      jaConversou: jaSeApresentou(params.history),
      foco: params.foco,
      abertura: aberturaDaEmpresa(params.history)
    }
  );
  const turns = buildTurns(params);

  // Um modelo por vez, na ordem da empresa: cota estourada, chave inválida ou
  // queda num deles passa para o próximo sem o cliente perceber.
  for (const provedor of provedores) {
    try {
      const text = await chamarProvedor(provedor, systemText, turns);

      if (!text || text.includes(HANDOFF_TOKEN)) {
        return { kind: "handoff", text: HANDOFF_MESSAGE };
      }

      return { kind: "reply", text };
    } catch (err) {
      // O corpo da resposta é o que diz a causa real (sem crédito, cota
      // estourada, chave inválida). Sem ele, o log só mostra "400".
      const detalhe = axios.isAxiosError(err)
        ? JSON.stringify(err.response?.data || "").slice(0, 400)
        : (err as Error)?.message;
      logger.error(
        { provider: provedor.provider, model: provedor.model, status: axios.isAxiosError(err) ? err.response?.status : undefined, detalhe },
        "[aiBot] modelo falhou; tentando o próximo da lista"
      );
    }
  }
  return { kind: "handoff", text: HANDOFF_MESSAGE, falha: true };
};
