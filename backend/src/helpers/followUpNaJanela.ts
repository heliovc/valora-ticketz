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
 * contagem são da última mensagem dele). Só em horário comercial — segunda a
 * sexta, das 9h às 18h de Brasília (Hélio, 12/11/2026: "follow-up precisamos
 * respeitar o horário"; fora dele a Val só RESPONDE quando o lead escreve). O
 * que vencer fora do horário sai na abertura seguinte — e só se a janela ainda
 * estiver aberta, porque fora dela só sairia modelo pago.
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
/** Horário comercial em Brasília: segunda (1) a sexta (5), das 9h às 18h (minutos do dia). */
export const HORARIO_COMERCIAL = { inicio: 9 * 60, fim: 18 * 60, dias: [1, 2, 3, 4, 5] };

const PASSO_MS = 10 * 60 * 1000;

export function minutosEmBrasilia(d: Date): number {
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
}

/** Dia da semana em Brasília (0 = domingo). */
export function diaDaSemanaEmBrasilia(d: Date): number {
  return new Date(d.getTime() - 3 * 60 * 60 * 1000).getUTCDay();
}

export function ehHorarioComercial(d: Date): boolean {
  if (!HORARIO_COMERCIAL.dias.includes(diaDaSemanaEmBrasilia(d))) return false;
  const m = minutosEmBrasilia(d);
  return m >= HORARIO_COMERCIAL.inicio && m < HORARIO_COMERCIAL.fim;
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
 * Horário-alvo do follow-up 3: 1 hora antes de a janela fechar; se cair fora do
 * horário comercial, o último horário comercial antes disso (e pelo menos 1
 * hora depois do 2). Sem horário comercial nesse intervalo, nulo: o 3 não sai.
 */
export function alvoDoFollowUp3(ultimaDoLead: Date, ultimoFollowUpEm: Date): Date | null {
  const fim = ultimaDoLead.getTime() + JANELA_MS;
  const limite = fim - MARGEM_DO_FIM_MS;
  const inicio = ultimoFollowUpEm.getTime() + INTERVALO_MINIMO_FOLLOW_UP_3_MS;
  const ideal = fim - ANTECEDENCIA_FOLLOW_UP_3_MS;
  if (inicio > limite) return null;
  // O mais tarde possível até o ideal…
  for (let t = Math.min(ideal, limite); t >= inicio; t -= PASSO_MS) {
    if (ehHorarioComercial(new Date(t))) return new Date(t);
  }
  // …ou, se antes do ideal não houver horário permitido, o primeiro depois dele.
  for (let t = Math.max(ideal, inicio); t <= limite; t += PASSO_MS) {
    if (ehHorarioComercial(new Date(t))) return new Date(t);
  }
  return null;
}

/** Qual follow-up sai agora (1, 2 ou 3), ou nulo. */
export function proximoFollowUp(e: EstadoDoFollowUp, agora: Date): 1 | 2 | 3 | null {
  const limite = e.ultimaDoLead.getTime() + JANELA_MS - MARGEM_DO_FIM_MS;
  const t = agora.getTime();
  if (t >= limite || !ehHorarioComercial(agora)) return null;
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

/**
 * Mensagens nossas separadas por pelo menos isto contam como toques diferentes
 * (a resposta ao lead e, depois, cada lembrete). Mensagens em sequência curta
 * são um toque só.
 */
export const INTERVALO_ENTRE_TOQUES_MS = 30 * 60 * 1000;

export interface MensagemParaContar {
  fromMe: boolean;
  createdAt?: Date | string | null;
  /** "ai" = a Val; "humano" = digitada no celular; nulo/outro = equipe pelo CRM ou automação. */
  sentBy?: string | null;
}

export interface FollowUpsJaFeitos {
  /** Lembretes nossos depois da resposta ao lead — da Val ou escritos à mão. */
  quantos: number;
  /** Última mensagem do último lembrete (nulo se nenhum). */
  ultimoEm: Date | null;
  /** O último lembrete teve mensagem que não foi da Val (alguém da equipe escreveu). */
  ultimoPelaEquipe: boolean;
}

/**
 * Follow-ups que JÁ saíram neste silêncio, lendo as mensagens — não só a
 * contagem da Val. Pedido do Hélio em 12/11/2026: "posso ter feito de forma
 * manual; a IA precisa ler as mensagens antes de tomar uma ação". O primeiro
 * bloco nosso depois da última mensagem do lead é a resposta a ele; cada bloco
 * seguinte é um lembrete, de quem quer que tenha escrito.
 */
export function followUpsJaFeitos(mensagens: MensagemParaContar[], ultimaDoLead: Date): FollowUpsJaFeitos {
  const corte = ultimaDoLead.getTime();
  const nossas = mensagens
    .filter(m => m.fromMe && m.createdAt)
    .map(m => ({ t: new Date(m.createdAt as Date | string).getTime(), daVal: m.sentBy === "ai" }))
    .filter(m => Number.isFinite(m.t) && m.t > corte)
    .sort((a, b) => a.t - b.t);
  const blocos: { fim: number; pelaEquipe: boolean }[] = [];
  for (const m of nossas) {
    const atual = blocos[blocos.length - 1];
    if (!atual || m.t - atual.fim >= INTERVALO_ENTRE_TOQUES_MS) blocos.push({ fim: m.t, pelaEquipe: !m.daVal });
    else {
      atual.fim = m.t;
      atual.pelaEquipe = atual.pelaEquipe || !m.daVal;
    }
  }
  const quantos = Math.max(0, blocos.length - 1);
  const ultimo = quantos > 0 ? blocos[blocos.length - 1] : null;
  return { quantos, ultimoEm: ultimo ? new Date(ultimo.fim) : null, ultimoPelaEquipe: !!ultimo?.pelaEquipe };
}

/**
 * Cadência no QR (número sem API oficial). Pedido do Hélio em 13/11/2026, caso
 * Claudio: no QR não há janela paga da Meta, então os lembretes se espalham por
 * cerca de duas semanas em vez de parar em 24h:
 *
 * 1. 2 horas depois da nossa última mensagem;
 * 2. no dia útil seguinte ao 1 (mesma hora);
 * 3. 3 dias úteis depois do 2;
 * 4. uma semana depois do 3 — o último, em tom de "fico à disposição".
 *
 * Sempre em horário comercial. O lead respondeu: volta ao 1.
 */
export const MAX_FOLLOW_UPS_QR = 4;
export const DIAS_UTEIS_ATE_O_2_QR = 1;
export const DIAS_UTEIS_ATE_O_3_QR = 3;
export const DIAS_ATE_O_4_QR = 7;
/** Silêncio do lead mais antigo que isto não entra na varredura do QR. */
export const HORIZONTE_QR_MS = 21 * 24 * 60 * 60 * 1000;
/**
 * O 1 só sai se a nossa última mensagem for recente (cobre o fim de semana).
 * Evita "primeiro lembrete" dias depois em conversa parada — por exemplo, na
 * subida desta regra.
 */
export const ATRASO_MAXIMO_DO_1_QR_MS = 3 * 24 * 60 * 60 * 1000;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Soma dias úteis (seg a sex, em Brasília), mantendo a hora. */
export function somarDiasUteis(d: Date, dias: number): Date {
  let t = d.getTime();
  let contados = 0;
  while (contados < dias) {
    t += DIA_MS;
    const dia = diaDaSemanaEmBrasilia(new Date(t));
    if (dia >= 1 && dia <= 5) contados += 1;
  }
  return new Date(t);
}

/** Qual follow-up sai agora no QR (1 a 4), ou nulo. */
export function proximoFollowUpQr(e: EstadoDoFollowUp, agora: Date): 1 | 2 | 3 | 4 | null {
  const t = agora.getTime();
  if (!ehHorarioComercial(agora)) return null;
  if (t > e.ultimaDoLead.getTime() + HORIZONTE_QR_MS) return null;
  if (e.enviados <= 0) {
    const desde = t - e.ultimaNossa.getTime();
    return desde >= ESPERA_FOLLOW_UP_1_MS && desde <= ATRASO_MAXIMO_DO_1_QR_MS ? 1 : null;
  }
  if (!e.ultimoFollowUpEm) return null;
  const ultimo = e.ultimoFollowUpEm;
  if (e.enviados === 1) return t >= somarDiasUteis(ultimo, DIAS_UTEIS_ATE_O_2_QR).getTime() ? 2 : null;
  if (e.enviados === 2) return t >= somarDiasUteis(ultimo, DIAS_UTEIS_ATE_O_3_QR).getTime() ? 3 : null;
  if (e.enviados === 3) return t >= ultimo.getTime() + DIAS_ATE_O_4_QR * DIA_MS ? 4 : null;
  return null;
}
