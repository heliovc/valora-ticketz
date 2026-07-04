import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../utils/logger";

/**
 * Helper de geração de respostas do bot de IA (Valora / Claude).
 *
 * Chave central da Valora via env `ANTHROPIC_API_KEY` (modelo gerenciado):
 * um único crédito atende todos os lojistas. A persona e a base de
 * conhecimento são configuradas por lojista (Company) e entram no system
 * prompt — com prompt caching no prefixo estável para baratear conversas.
 *
 * Handoff: quando o modelo julgar que deve passar para um humano (cliente
 * pediu atendente, ou não é seguro responder), ele responde APENAS com o
 * token `HANDOFF_TOKEN`. Nesse caso `generateBotReply` retorna `null` e o
 * chamador deixa o ticket para atendimento humano (sem auto-resposta).
 */

const AI_MODEL = process.env.AI_BOT_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = Number(process.env.AI_BOT_MAX_TOKENS || 600);
const HANDOFF_TOKEN = "__HUMANO__";

export type BotTurn = { role: "user" | "assistant"; text: string };

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

/** Indica se o bot de IA pode operar (chave central presente). */
export function isAiBotAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildSystemPrompt(
  persona: string,
  knowledge: string | undefined,
  contactName: string | undefined
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
  return parts.join("\n\n");
}

/**
 * Gera a resposta do bot. Retorna o texto a enviar, ou `null` quando não há
 * resposta automática (handoff, chave ausente ou erro) — nesse caso o
 * chamador deve deixar o ticket para atendimento humano.
 */
export const generateBotReply = async (
  params: GenerateBotReplyParams
): Promise<string | null> => {
  const anthropic = getClient();
  if (!anthropic) {
    logger.warn("[aiBot] ANTHROPIC_API_KEY ausente — bot de IA desabilitado");
    return null;
  }

  const systemText = buildSystemPrompt(
    params.persona,
    params.knowledge,
    params.contactName
  );

  const messages: Anthropic.MessageParam[] = [
    ...params.history.map(
      (turn): Anthropic.MessageParam => ({
        role: turn.role,
        content: turn.text
      })
    ),
    { role: "user", content: params.userMessage }
  ];

  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: MAX_TOKENS,
      // Prefixo estável (persona + base) cacheado para baratear conversas.
      system: [
        {
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();

    if (!text || text.includes(HANDOFF_TOKEN)) {
      return null;
    }

    return text;
  } catch (err) {
    logger.error({ err }, "[aiBot] falha ao gerar resposta do bot");
    return null;
  }
};
