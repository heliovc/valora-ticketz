/**
 * Ritmo da automação no número normal (QR).
 *
 * Em 06/11/2026 a Meta restringiu o número da Val depois de semanas de
 * prospecção saindo uma mensagem a cada 5 segundos. Decisão do Hélio (08/11):
 * no QR, no máximo um envio automático a cada 2 minutos por número e no máximo
 * 30 aberturas (primeira mensagem a quem nunca recebeu nada nosso) por dia. O
 * que passar do teto fica para as 9h do dia seguinte.
 *
 * Funções puras: o estado (próximo horário livre e aberturas do dia) fica no
 * Redis, lido e gravado por quem chama.
 */

export const INTERVALO_PADRAO_MS = 120 * 1000;
export const ABERTURAS_POR_DIA_PADRAO = 30;
/** Hora de Brasília em que as aberturas que passaram do teto voltam a sair. */
export const HORA_DE_RETOMAR = 9;
/** Brasília não tem horário de verão desde 2019. */
const FUSO_MS = 3 * 60 * 60 * 1000;
/** Folga para o job que a fila soltou alguns milissegundos antes do horário. */
const FOLGA_MS = 1000;

export interface ConfigDoRitmo {
  intervaloMs: number;
  maxAberturasPorDia: number;
}

function numeroDoAmbiente(valor: string | undefined, padrao: number): number {
  if (valor === undefined || valor.trim() === "") return padrao;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** `FUNIL_QR_INTERVALO_SEGUNDOS` e `FUNIL_QR_ABERTURAS_POR_DIA`; 0 desliga cada um. */
export function lerConfigDoRitmo(env: NodeJS.ProcessEnv = process.env): ConfigDoRitmo {
  return {
    intervaloMs: numeroDoAmbiente(env.FUNIL_QR_INTERVALO_SEGUNDOS, INTERVALO_PADRAO_MS / 1000) * 1000,
    maxAberturasPorDia: numeroDoAmbiente(env.FUNIL_QR_ABERTURAS_POR_DIA, ABERTURAS_POR_DIA_PADRAO)
  };
}

/** Data (AAAA-MM-DD) no horário de Brasília: o teto de aberturas vira à meia-noite daqui. */
export function dataEmBrasilia(agora: Date): string {
  return new Date(agora.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

/** Milissegundos até as 9h de Brasília do dia seguinte. */
export function msAteAmanhaAsNove(agora: Date): number {
  const local = new Date(agora.getTime() - FUSO_MS);
  const alvoLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() + 1,
    HORA_DE_RETOMAR
  );
  return Math.max(0, alvoLocal + FUSO_MS - agora.getTime());
}

export type DecisaoDeRitmo =
  /** Envia agora. `novoProximoLivreEm` (ms) é gravado quando vier. */
  | { acao: "enviar"; novoProximoLivreEm: number | null }
  /** Reserva um horário futuro e reagenda o job para ele. */
  | { acao: "reservar"; esperarMs: number; horarioReservado: number; novoProximoLivreEm: number }
  /** Teto de aberturas do dia atingido: volta amanhã às 9h, sem reserva. */
  | { acao: "amanha"; esperarMs: number };

/**
 * O envio automático sai agora?
 *
 * Quem tem de esperar ganha um horário só dele (`horarioReservado`), e o
 * próximo livre anda um intervalo. Assim uma lista de 50 cards vira 50 envios
 * espaçados, cada job reagendado uma vez só, em vez de todos acordando juntos
 * a cada 2 minutos.
 */
export function decidirRitmo(p: {
  agora: Date;
  /** Próximo horário livre gravado para o número (ms), ou nulo. */
  proximoLivreEm: number | null;
  /** Horário que este job já reservou numa passada anterior (ms). */
  horarioReservado?: number | null;
  aberturasHoje: number;
  ehAbertura: boolean;
  config: ConfigDoRitmo;
}): DecisaoDeRitmo {
  const agoraMs = p.agora.getTime();
  const { intervaloMs, maxAberturasPorDia } = p.config;

  if (p.ehAbertura && maxAberturasPorDia > 0 && p.aberturasHoje >= maxAberturasPorDia) {
    return { acao: "amanha", esperarMs: msAteAmanhaAsNove(p.agora) };
  }
  if (intervaloMs <= 0) return { acao: "enviar", novoProximoLivreEm: null };

  // Chegou o horário que este job reservou: sai sem reservar outro.
  if (p.horarioReservado && p.horarioReservado <= agoraMs + FOLGA_MS) {
    return { acao: "enviar", novoProximoLivreEm: null };
  }

  const base = Math.max(agoraMs, p.proximoLivreEm || 0);
  if (base <= agoraMs + FOLGA_MS) {
    return { acao: "enviar", novoProximoLivreEm: agoraMs + intervaloMs };
  }
  return {
    acao: "reservar",
    esperarMs: base - agoraMs,
    horarioReservado: base,
    novoProximoLivreEm: base + intervaloMs
  };
}
