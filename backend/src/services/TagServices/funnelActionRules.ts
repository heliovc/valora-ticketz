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

export type TipoDeAcao =
  | "mensagem"
  | "bot_ligar"
  | "bot_desligar"
  /**
   * Avisa alguém da equipe por e-mail. O e-mail NÃO sai daqui: o motor do CRM
   * não sabe enviar e-mail, e duplicar essa configuração criaria dois lugares
   * para quebrar. Quem envia é a Valora, avisada por este executor.
   */
  | "email"
  /**
   * Envia um modelo aprovado pelo WhatsApp Oficial — o único jeito de escrever
   * para quem nunca falou com a empresa (ex.: lead importado em lote).
   */
  | "modelo"
  /** Leva o card para outra lista do quadro (`config.tagId`). */
  | "mover"
  /**
   * Escolhe quem da equipe atende o card (`config.userIds`, `config.modo`
   * fixo|rodizio) e grava como responsável. Pedido do Hélio (29/10/2026): quando
   * a IA passa a conversa, alguém tem nome e sobrenome para responder.
   */
  | "atribuir";

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
  sentAt?: Date | string | null;
  skippedReason?: string | null;
}

/**
 * A execução anterior não chegou a fazer nada: foi descartada ou falhou (ex.:
 * "falha: Connection Closed" com o WhatsApp caído). Para "só na primeira vez"
 * ela não conta — senão um envio que nunca saiu trava o card para sempre
 * (4 cards da W1 da Valora, 29/10/2026).
 */
export function disparoNaoSaiu(d: UltimoDisparo): boolean {
  return !d.sentAt && !!d.skippedReason;
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
  "bot_desligar",
  "email",
  "modelo",
  "mover",
  "atribuir"
];

/**
 * Ação que muda só o estado interno da conversa, sem falar com o cliente.
 *
 * Nunca espera expediente: adiar "ligue o bot" até as 9h da manhã deixaria o
 * cliente sem resposta a noite inteira — exatamente o buraco que o bot existe
 * para tapar.
 */
export function ehAcaoSilenciosa(tipo: string): boolean {
  return tipo === "bot_ligar" || tipo === "bot_desligar" || tipo === "mover" || tipo === "atribuir";
}

/**
 * Rodízio: entre as pessoas marcadas, a próxima depois da última que recebeu.
 * Fixo (ou uma pessoa só): sempre a primeira. Lista vazia: ninguém — quem
 * chama cai no dono da conta.
 */
export function escolherResponsavel(
  userIds: number[],
  modo: string | null | undefined,
  ultimo: number | null | undefined
): number | null {
  const ids = userIds.map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!ids.length) return null;
  if (modo !== "rodizio" || ids.length === 1) return ids[0];
  const i = ids.indexOf(Number(ultimo));
  return ids[(i + 1) % ids.length];
}

/**
 * Ação que sai para fora e por isso pode esperar o expediente.
 *
 * E-mail entra aqui junto com a mensagem: avisar o dono da loja às 3h da manhã
 * é o tipo de automação que a pessoa desliga no dia seguinte.
 */
export function respeitaExpedienteSeConfigurado(tipo: string): boolean {
  return tipo === "mensagem" || tipo === "email" || tipo === "modelo";
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
  if (acao.tipo === "mover" && !Number(acao.config?.tagId)) {
    return { agendar: false, motivo: "ação de mover sem lista de destino" };
  }

  if (ultimoDisparo) {
    if (acao.umaVezSo !== false && !disparoNaoSaiu(ultimoDisparo)) {
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

/**
 * O cliente escreveu depois de `desde`? Vale o mais recente entre a última
 * mensagem dele em QUALQUER canal (`lastClientMessageAt`) e a do Oficial
 * (`lastInboundAt`). Antes só olhava `lastInboundAt`, que o WhatsApp comum
 * (QR) e o chat do site nunca gravam: o follow-up "fiquei sem retorno" saía
 * para quem já tinha respondido (29/10/2026).
 */
export function clienteRespondeuDesde(
  ticket: {
    lastClientMessageAt?: Date | string | null;
    lastInboundAt?: Date | string | null;
  },
  desde: Date | string | null | undefined
): boolean {
  if (!desde) return false;
  const limite = new Date(desde).getTime();
  return [ticket.lastClientMessageAt, ticket.lastInboundAt].some(
    d => !!d && new Date(d).getTime() > limite
  );
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
  /** Follow-up: só sai se o cliente continuou em silêncio desde o agendamento. */
  soSemResposta?: boolean;
  /** O cliente mandou mensagem depois que a ação foi agendada. */
  clienteRespondeu?: boolean;
  /**
   * Follow-up da Entrada: ninguém (equipe, IA ou automação) falou com o
   * cliente ainda. Não há silêncio dele para cobrar — quem deve resposta somos nós.
   */
  semNossaResposta?: boolean;
  /** Reaviso: só sai se ninguém da equipe respondeu desde o agendamento. */
  soSemAtendimento?: boolean;
  /** Alguém da equipe escreveu na conversa (ou finalizou) depois do agendamento. */
  equipeAtendeu?: boolean;
}): DecisaoDeExecucao {
  // Mandar "obrigado pela compra" para quem voltou para "negociação" é pior do
  // que não mandar nada. Vale para qualquer tipo: ligar o bot de uma lista que
  // o card já deixou também está errado.
  if (params.exigeLista && !params.aindaNaLista) {
    return { acao: "descartar", motivo: "card saiu da lista antes da execução" };
  }

  // Follow-up de silêncio: "ainda está aí?" para quem acabou de responder é
  // constrangedor. A conversa continuou — a cobrança de retorno não cabe mais.
  if (params.soSemResposta && params.clienteRespondeu) {
    return { acao: "descartar", motivo: "o cliente respondeu antes do follow-up" };
  }
  if (params.soSemResposta && params.semNossaResposta) {
    return { acao: "descartar", motivo: "ninguém respondeu o cliente ainda" };
  }

  // Reaviso de lead esperando: alguém já respondeu, não há o que cobrar.
  if (params.soSemAtendimento && params.equipeAtendeu) {
    return { acao: "descartar", motivo: "a equipe já atendeu" };
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
 * A chave geral da empresa é o interruptor mestre: desligada, o bot não
 * responde em NENHUM card, nem nos que uma lista ou o botão do card ligaram.
 * Decisão do Hélio em 28/09/2026, depois de o bot responder um cliente com a
 * plataforma desligada porque o card tinha sido ligado antes.
 *
 * Com a chave geral ligada, a conversa pode sair do padrão: desligar quando um
 * humano assume (bot por cima do atendente é o erro que o cliente percebe na
 * hora) ou ser ligada por uma lista. Para o bot atuar só em parte do funil,
 * liga-se a chave geral e desliga-se na Entrada do funil.
 */
export function botDeveResponder(
  daConversa: boolean | null | undefined,
  daEmpresa: boolean
): boolean {
  if (!daEmpresa) return false;
  return daConversa !== false;
}

/** Qual bot uma ação "ligar/desligar o bot" controla. */
export type BotDoFunil = "atendimento" | "val_vendas";

/**
 * Ações gravadas antes da escolha (28/10/2026) não têm `config.bot`: elas
 * sempre mexeram no bot de atendimento, e continuam mexendo.
 */
export function botDaAcao(config: Record<string, unknown> | null | undefined): BotDoFunil {
  return config?.bot === "val_vendas" ? "val_vendas" : "atendimento";
}

export type QuemResponde = "val_vendas" | "atendimento" | "nenhum";

/**
 * Quem responde num número. O número decide o bot: nos da Val Vendas o bot de
 * atendimento nunca fala, e fora deles a Val Vendas nunca fala. Espelha
 * `escopoDeVendas` + `botDeveResponder` para a tela "Bots" dizer a verdade.
 */
export function quemRespondeNoNumero(
  whatsappId: number,
  estado: {
    numerosDaValVendas: number[];
    valVendasLigada: boolean;
    atendimentoLigado: boolean;
    atendimentoTemModelo: boolean;
  }
): { bot: QuemResponde; ligado: boolean } {
  if (estado.numerosDaValVendas.map(Number).includes(Number(whatsappId))) {
    return { bot: "val_vendas", ligado: estado.valVendasLigada };
  }
  const ligado = estado.atendimentoLigado && estado.atendimentoTemModelo;
  return { bot: ligado ? "atendimento" : "nenhum", ligado };
}
