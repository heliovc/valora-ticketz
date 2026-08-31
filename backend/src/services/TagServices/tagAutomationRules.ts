/**
 * As decisões do gatilho de lista, separadas do envio.
 *
 * Ficam aqui, sem Bull, sem Redis e sem WhatsApp, porque é a parte que precisa
 * ser conferida com teste: mandar duas vezes, mandar para quem já saiu da lista
 * ou mandar de madrugada são erros que só aparecem no telefone do cliente do
 * cliente — tarde demais.
 */

export interface RegraDaLista {
  autoMessage?: string | null;
  autoOnce?: boolean;
  companyId: number;
}

export interface UltimoDisparo {
  createdAt: Date | string;
}

export type DecisaoDeAgendamento =
  | { agendar: true }
  | { agendar: false; motivo: string };

/** Janela que impede dois cliques seguidos de virarem duas mensagens. */
export const JANELA_ANTI_DUPLICIDADE_SEGUNDOS = 60;

export function decidirAgendamento(
  tag: RegraDaLista | null,
  companyId: number,
  ultimoDisparo: UltimoDisparo | null,
  agora: Date = new Date()
): DecisaoDeAgendamento {
  if (!tag) return { agendar: false, motivo: "lista não existe" };
  if (!tag.autoMessage?.trim()) {
    return { agendar: false, motivo: "lista sem gatilho" };
  }
  // Isolamento entre empresas vale aqui também: etiqueta de outra empresa nunca
  // dispara mensagem nesta.
  if (tag.companyId !== companyId) {
    return { agendar: false, motivo: "lista de outra empresa" };
  }

  if (ultimoDisparo) {
    if (tag.autoOnce !== false) {
      return { agendar: false, motivo: "já disparou e está marcado como só na primeira vez" };
    }
    const segundos =
      (agora.getTime() - new Date(ultimoDisparo.createdAt).getTime()) / 1000;
    if (segundos < JANELA_ANTI_DUPLICIDADE_SEGUNDOS) {
      return { agendar: false, motivo: "disparo repetido em menos de um minuto" };
    }
  }

  return { agendar: true };
}

export type DecisaoDeEnvio =
  | { acao: "enviar" }
  | { acao: "postergar" }
  | { acao: "descartar"; motivo: string };

export function decidirEnvio(params: {
  /** O card ainda está na lista? Pode ter saído durante a espera. */
  aindaNaLista: boolean;
  temMensagem: boolean;
  respeitaExpediente: boolean;
  dentroDoExpediente: boolean;
  postergacoes: number;
  maxPostergacoes: number;
}): DecisaoDeEnvio {
  if (!params.temMensagem) {
    return { acao: "descartar", motivo: "lista sem mensagem" };
  }
  // Mandar "obrigado pela compra" para quem voltou para "negociação" é pior do
  // que não mandar nada.
  if (!params.aindaNaLista) {
    return { acao: "descartar", motivo: "card saiu da lista antes do envio" };
  }
  if (params.respeitaExpediente && !params.dentroDoExpediente) {
    if (params.postergacoes >= params.maxPostergacoes) {
      return { acao: "descartar", motivo: "expediente fechado por tempo demais" };
    }
    return { acao: "postergar" };
  }
  return { acao: "enviar" };
}
