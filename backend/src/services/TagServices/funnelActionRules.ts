/**
 * As decisões da automação do funil, separadas da execução.
 *
 * Mesmo motivo do gatilho de mensagem que veio antes: mandar duas vezes, mandar
 * para quem já saiu da lista ou tocar o telefone do cliente de madrugada são
 * erros que só aparecem no celular do cliente do cliente — tarde demais.
 *
 * Aqui a automação virou uma LISTA de ações por lista, então a decisão ganhou
 * uma pergunta nova: cada TIPO de ação tem regras diferentes. Ligar o bot não é
 * mandar mensagem — não acorda ninguém, e adiar até o expediente abrir seria o
 * oposto do que se quer (o bot existe justamente para atender fora de hora).
 */

export type TipoDeAcao = "mensagem" | "bot_ligar" | "bot_desligar";

export interface AcaoDoFunil {
  id: number;
  tipo: string;
  config?: Record<string, unknown> | null;
  atrasoMinutos?: number | null;
  umaVezSo?: boolean | null;
  soHorarioComercial?: boolean | null;
  ativo?: boolean | null;
  companyId: number;
}

export interface UltimoDisparo {
  createdAt: Date | string;
}

export type DecisaoDeAgendamento =
  | { agendar: true; imediato: boolean }
  | { agendar: false; motivo: string };

/** Janela que impede dois cliques seguidos de virarem duas execuções. */
export const JANELA_ANTI_DUPLICIDADE_SEGUNDOS = 60;

/** Tipos que o executor sabe fazer. Tipo fora daqui é ignorado, nunca quebra. */
export const TIPOS_CONHECIDOS: TipoDeAcao[] = [
  "mensagem",
  "bot_ligar",
  "bot_desligar"
];

/**
 * Ação que muda só o estado interno da conversa, sem falar com o cliente.
 *
 * Nunca espera expediente: adiar "ligue o bot" até as 9h da manhã deixaria o
 * cliente sem resposta a noite inteira — exatamente o buraco que o bot existe
 * para tapar.
 */
export function ehAcaoSilenciosa(tipo: string): boolean {
  return tipo === "bot_ligar" || tipo === "bot_desligar";
}

export function decidirAgendamento(
  acao: AcaoDoFunil | null,
  companyId: number,
  ultimoDisparo: UltimoDisparo | null,
  agora: Date = new Date()
): DecisaoDeAgendamento {
  if (!acao) return { agendar: false, motivo: "ação não existe" };
  if (acao.ativo === false) return { agendar: false, motivo: "ação desligada" };
  if (!TIPOS_CONHECIDOS.includes(acao.tipo as TipoDeAcao)) {
    return { agendar: false, motivo: `tipo desconhecido: ${acao.tipo}` };
  }
  // Isolamento entre empresas: automação de outra empresa nunca age nesta.
  if (acao.companyId !== companyId) {
    return { agendar: false, motivo: "automação de outra empresa" };
  }
  if (acao.tipo === "mensagem" && !String(acao.config?.mensagem ?? "").trim()) {
    return { agendar: false, motivo: "ação de mensagem sem texto" };
  }

  if (ultimoDisparo) {
    if (acao.umaVezSo !== false) {
      return {
        agendar: false,
        motivo: "já executou e está marcado como só na primeira vez"
      };
    }
    const segundos =
      (agora.getTime() - new Date(ultimoDisparo.createdAt).getTime()) / 1000;
    if (segundos < JANELA_ANTI_DUPLICIDADE_SEGUNDOS) {
      return { agendar: false, motivo: "execução repetida em menos de um minuto" };
    }
  }

  // Ação silenciosa sem atraso roda NA HORA, fora da fila.
  //
  // É o que faz o bot responder a PRIMEIRA mensagem de uma conversa nova: a
  // fila levaria alguns instantes e a mensagem já teria passado pelo bot com a
  // chave ainda desligada.
  const atraso = Math.max(0, acao.atrasoMinutos ?? 0);
  return { agendar: true, imediato: ehAcaoSilenciosa(acao.tipo) && atraso === 0 };
}

export type DecisaoDeExecucao =
  | { acao: "executar" }
  | { acao: "postergar" }
  | { acao: "descartar"; motivo: string };

export function decidirExecucao(params: {
  tipo: string;
  /** O card ainda está na lista? Pode ter saído durante a espera. */
  aindaNaLista: boolean;
  /** Automação de conversa nova não pertence a lista nenhuma. */
  exigeLista: boolean;
  respeitaExpediente: boolean;
  dentroDoExpediente: boolean;
  postergacoes: number;
  maxPostergacoes: number;
}): DecisaoDeExecucao {
  // Mandar "obrigado pela compra" para quem voltou para "negociação" é pior do
  // que não mandar nada. Vale para qualquer tipo: ligar o bot de uma lista que
  // o card já deixou também está errado.
  if (params.exigeLista && !params.aindaNaLista) {
    return { acao: "descartar", motivo: "card saiu da lista antes da execução" };
  }

  // Ação silenciosa ignora expediente — ver `ehAcaoSilenciosa`.
  if (
    !ehAcaoSilenciosa(params.tipo) &&
    params.respeitaExpediente &&
    !params.dentroDoExpediente
  ) {
    if (params.postergacoes >= params.maxPostergacoes) {
      return { acao: "descartar", motivo: "expediente fechado por tempo demais" };
    }
    return { acao: "postergar" };
  }

  return { acao: "executar" };
}

/**
 * O bot responde nesta conversa?
 *
 * A decisão da CONVERSA vence a da empresa, nos dois sentidos: uma lista pode
 * ligar o bot numa conta que o tem desligado por padrão (triagem automática só
 * em parte do funil), e pode desligá-lo quando um humano assume — que é o caso
 * que mais importa, porque bot respondendo por cima do atendente é o erro que o
 * cliente percebe na hora.
 */
export function botDeveResponder(
  daConversa: boolean | null | undefined,
  daEmpresa: boolean
): boolean {
  if (daConversa === true) return true;
  if (daConversa === false) return false;
  return daEmpresa;
}
