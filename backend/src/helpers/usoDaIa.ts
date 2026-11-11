import { createHash } from "crypto";

/**
 * Consumo das IAs dos bots (pedido do Hélio, 10/11/2026: "preciso de um local
 * para saber como estão os consumos de token, crédito, necessidade de recarga").
 *
 * Aqui só regra pura: ler o uso que cada provedor devolve, estimar o custo
 * quando o provedor não informa, classificar a falha e identificar a chave sem
 * nunca guardá-la. Quem grava é `services/AiUsageServices`.
 */

export type ProvedorDeIa = "gemini" | "groq" | "anthropic" | "openrouter";

export interface UsoMedido {
  inputTokens: number;
  outputTokens: number;
  /** Dólares. Nulo = o provedor não informou e não há preço conhecido. */
  costUsd: number | null;
}

export interface Medidor {
  somar(uso: UsoMedido): void;
  total(): UsoMedido;
}

/** Soma o uso das várias rodadas de uma resposta (ferramenta, nova tentativa…). */
export function novoMedidor(): Medidor {
  let inputTokens = 0;
  let outputTokens = 0;
  let custo: number | null = null;
  return {
    somar(u) {
      inputTokens += u.inputTokens || 0;
      outputTokens += u.outputTokens || 0;
      if (u.costUsd !== null && u.costUsd !== undefined) custo = (custo || 0) + u.costUsd;
    },
    total: () => ({ inputTokens, outputTokens, costUsd: custo })
  };
}

const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Preço da Anthropic por milhão de tokens (entrada, saída), em dólares, na API
 * direta (tabela de 06/10/2026). Leitura de cache custa 0,1x a entrada; escrita,
 * 1,25x. Ordem importa: o primeiro prefixo que casa vence.
 */
const PRECO_ANTHROPIC: Array<[string, number, number]> = [
  ["claude-fable-5", 10, 50],
  ["claude-mythos-5", 10, 50],
  ["claude-opus-5-5", 4, 20],
  ["claude-opus-5", 5, 25],
  ["claude-opus-4-1", 15, 75],
  ["claude-opus-4-0", 15, 75],
  ["claude-opus-4", 5, 25],
  ["claude-sonnet-5", 2, 10],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-5-5", 0.1, 0.5],
  ["claude-haiku-4-5", 1, 5],
  ["claude-3-5-haiku", 0.8, 4]
];

export function precoAnthropic(model: string): { entrada: number; saida: number } | null {
  const m = String(model || "").toLowerCase();
  const achado = PRECO_ANTHROPIC.find(([prefixo]) => m.startsWith(prefixo));
  return achado ? { entrada: achado[1], saida: achado[2] } : null;
}

/**
 * Uso devolvido por cada provedor, no formato de cada um:
 * - Anthropic: `usage.input_tokens`, `output_tokens`, `cache_*_input_tokens`;
 * - Gemini: `usageMetadata.promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`;
 * - Groq/OpenRouter: `usage.prompt_tokens`, `completion_tokens` e, no OpenRouter, `cost`.
 */
export function lerUso(provider: ProvedorDeIa, corpo: any, model = ""): UsoMedido {
  if (provider === "anthropic") {
    const u = corpo?.usage || {};
    const entrada = n(u.input_tokens);
    const lidoDoCache = n(u.cache_read_input_tokens);
    const gravadoNoCache = n(u.cache_creation_input_tokens);
    const saida = n(u.output_tokens);
    const preco = precoAnthropic(model);
    const costUsd = preco
      ? (entrada * preco.entrada + lidoDoCache * preco.entrada * 0.1 + gravadoNoCache * preco.entrada * 1.25 + saida * preco.saida) /
        1_000_000
      : null;
    return { inputTokens: entrada + lidoDoCache + gravadoNoCache, outputTokens: saida, costUsd };
  }
  if (provider === "gemini") {
    const u = corpo?.usageMetadata || {};
    // Camada gratuita: sem custo informado pela API.
    return { inputTokens: n(u.promptTokenCount), outputTokens: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount), costUsd: null };
  }
  const u = corpo?.usage || {};
  const custo = u.cost ?? u.total_cost;
  return {
    inputTokens: n(u.prompt_tokens),
    outputTokens: n(u.completion_tokens),
    costUsd: provider === "openrouter" && custo !== undefined && custo !== null && Number.isFinite(Number(custo)) ? Number(custo) : null
  };
}

export type FalhaDaIa = "sem_credito" | "cota" | "chave_invalida" | "tempo" | "outro";

/** Por que a chamada falhou, no que importa para recarga: crédito, cota, chave, tempo. */
export function classificarFalhaDaIa(err: any): FalhaDaIa {
  const status = Number(err?.response?.status ?? err?.status ?? 0);
  const corpo = (() => {
    try {
      return JSON.stringify(err?.response?.data ?? err?.error ?? "");
    } catch {
      return "";
    }
  })();
  const texto = `${corpo} ${String(err?.message || "")}`;
  if (status === 402 || /credit balance|insufficient[_ ]?(credits|funds|quota)|more credits|billing/i.test(texto)) return "sem_credito";
  if (status === 429 || /quota|RESOURCE_EXHAUSTED|rate[_ ]?limit/i.test(texto)) return "cota";
  if (status === 401 || status === 403 || /invalid[_ ]?api[_ ]?key|API key not valid|PERMISSION_DENIED|authentication/i.test(texto)) {
    return "chave_invalida";
  }
  if (err?.code === "ECONNABORTED" || /timeout|timed out/i.test(texto)) return "tempo";
  return "outro";
}

/** Impressão digital da chave: agrupa o uso sem guardar a chave. */
export function digitalDaChave(apiKey: string): string {
  return createHash("sha256").update(String(apiKey || "")).digest("hex").slice(0, 12);
}
