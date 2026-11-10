/**
 * Quando a Val manda o follow-up de quem respondeu e parou (pedido do Hélio em
 * 10/11/2026): antes de a janela de 24h do WhatsApp Oficial fechar, para não
 * pagar modelo, e nunca de madrugada.
 *
 * Regra: o ideal é 20h depois da última mensagem do lead. Se de 20h até o fim
 * da janela (23,5h) não houver horário diurno, manda no primeiro horário
 * diurno depois de 8h de silêncio — antes da janela fechar. Fora disso, espera.
 */
export const SILENCIO_IDEAL_MS = 20 * 60 * 60 * 1000;
export const SILENCIO_MINIMO_MS = 8 * 60 * 60 * 1000;
export const FIM_DA_JANELA_MS = 23.5 * 60 * 60 * 1000;
/** Horário diurno em Brasília, em minutos do dia: 8h às 21h. */
export const DIURNO = { inicio: 8 * 60, fim: 21 * 60 };

export function minutosEmBrasilia(d: Date): number {
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
}

export function ehDiurno(d: Date): boolean {
  const m = minutosEmBrasilia(d);
  return m >= DIURNO.inicio && m < DIURNO.fim;
}

function haDiurnoEntre(de: number, ate: number): boolean {
  for (let t = de; t <= ate; t += 10 * 60 * 1000) if (ehDiurno(new Date(t))) return true;
  return false;
}

export function deveMandarFollowUp(ultimaDoLead: Date, agora: Date): boolean {
  const ultima = ultimaDoLead.getTime();
  const silencio = agora.getTime() - ultima;
  if (silencio < SILENCIO_MINIMO_MS || silencio > FIM_DA_JANELA_MS) return false;
  if (!ehDiurno(agora)) return false;
  if (silencio >= SILENCIO_IDEAL_MS) return true;
  return !haDiurnoEntre(ultima + SILENCIO_IDEAL_MS, ultima + FIM_DA_JANELA_MS);
}
