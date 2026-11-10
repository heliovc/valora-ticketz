/**
 * Quando a Val manda cada follow-up no WhatsApp Oficial (regra do Hélio,
 * 10/11/2026, segunda versão):
 *
 * 1. Follow-up 1: 2 horas depois da última mensagem da IA, se o lead não respondeu.
 * 2. Follow-up 2: 10 horas depois do follow-up 1, se o lead ainda não respondeu.
 * 3. Follow-up 3: antes de a janela de 24h da Meta fechar (mira 1 hora antes),
 *    se o follow-up 2 ficou sem resposta.
 *
 * O lead respondeu no meio: a contagem volta ao follow-up 1 (a janela e a
 * contagem são da última mensagem dele). Nunca entre 22h e 8h (Brasília): o
 * que vencer de madrugada sai às 8h — e só se a janela ainda estiver aberta,
 * porque fora dela só sairia modelo pago.
 */
export const JANELA_MS = 24 * 60 * 60 * 1000;
export const ESPERA_FOLLOW_UP_1_MS = 2 * 60 * 60 * 1000;
export const ESPERA_FOLLOW_UP_2_MS = 10 * 60 * 60 * 1000;
/** O 3 mira esta antecedência do fim da janela. */
export const ANTECEDENCIA_FOLLOW_UP_3_MS = 60 * 60 * 1000;
/** O 3 nunca sai colado no 2. */
export const INTERVALO_MINIMO_FOLLOW_UP_3_MS = 60 * 60 * 1000;
/** Depois disto, perto demais do fim da janela para arriscar o envio. */
export const MARGEM_DO_FIM_MS = 10 * 60 * 1000;
export const MAX_FOLLOW_UPS = 3;
/** Horário permitido em Brasília, em minutos do dia: 8h às 22h. */
export const DIURNO = { inicio: 8 * 60, fim: 22 * 60 };

const PASSO_MS = 10 * 60 * 1000;

export function minutosEmBrasilia(d: Date): number {
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
}

export function ehDiurno(d: Date): boolean {
  const m = minutosEmBrasilia(d);
  return m >= DIURNO.inicio && m < DIURNO.fim;
}

export interface EstadoDoFollowUp {
  /** Última mensagem do lead: abre a janela de 24h e zera a contagem. */
  ultimaDoLead: Date;
  /** Última mensagem nossa (a resposta da IA ou o último follow-up). */
  ultimaNossa: Date;
  /** Follow-ups já enviados desde a última mensagem do lead. */
  enviados: number;
  /** Quando saiu o último follow-up (nulo se nenhum). */
  ultimoFollowUpEm: Date | null;
}

/**
 * Horário-alvo do follow-up 3: 1 hora antes de a janela fechar; se cair entre
 * 22h e 8h, o último horário permitido antes disso (e pelo menos 1 hora depois
 * do 2). Sem horário permitido nesse intervalo, nulo: o 3 não sai.
 */
export function alvoDoFollowUp3(ultimaDoLead: Date, ultimoFollowUpEm: Date): Date | null {
  const fim = ultimaDoLead.getTime() + JANELA_MS;
  const limite = fim - MARGEM_DO_FIM_MS;
  const inicio = ultimoFollowUpEm.getTime() + INTERVALO_MINIMO_FOLLOW_UP_3_MS;
  const ideal = fim - ANTECEDENCIA_FOLLOW_UP_3_MS;
  if (inicio > limite) return null;
  // O mais tarde possível até o ideal…
  for (let t = Math.min(ideal, limite); t >= inicio; t -= PASSO_MS) {
    if (ehDiurno(new Date(t))) return new Date(t);
  }
  // …ou, se antes do ideal não houver horário permitido, o primeiro depois dele.
  for (let t = Math.max(ideal, inicio); t <= limite; t += PASSO_MS) {
    if (ehDiurno(new Date(t))) return new Date(t);
  }
  return null;
}

/** Qual follow-up sai agora (1, 2 ou 3), ou nulo. */
export function proximoFollowUp(e: EstadoDoFollowUp, agora: Date): 1 | 2 | 3 | null {
  const limite = e.ultimaDoLead.getTime() + JANELA_MS - MARGEM_DO_FIM_MS;
  const t = agora.getTime();
  if (t >= limite || !ehDiurno(agora)) return null;
  if (e.enviados <= 0) {
    return t >= e.ultimaNossa.getTime() + ESPERA_FOLLOW_UP_1_MS ? 1 : null;
  }
  if (!e.ultimoFollowUpEm) return null;
  if (e.enviados === 1) {
    return t >= e.ultimoFollowUpEm.getTime() + ESPERA_FOLLOW_UP_2_MS ? 2 : null;
  }
  if (e.enviados === 2) {
    const alvo = alvoDoFollowUp3(e.ultimaDoLead, e.ultimoFollowUpEm);
    return alvo && t >= alvo.getTime() ? 3 : null;
  }
  return null;
}
