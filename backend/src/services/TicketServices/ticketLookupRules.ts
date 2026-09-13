/**
 * Como decidir se uma mensagem cai num card já aberto ou abre um novo.
 *
 * Fica aqui, sem Sequelize, pelo mesmo motivo do gatilho de lista: é a parte
 * que precisa de teste. O erro que esta regra evita só aparece na frente do
 * cliente — dois cards para a mesma pessoa, e um deles preso numa conexão de
 * WhatsApp que já caiu, sem conseguir responder.
 *
 * Histórico: o Ticketz original separava as conversas por CONEXÃO de propósito
 * (upstream 48fc4ac, "Accept multiple tickets from same contact on different
 * connections") — faz sentido para quem atende em vários números. Aqui, quando
 * a conexão do lojista caiu e foi recriada, todo contato que tinha conversa na
 * antiga ganhou uma segunda na nova. Decisão do Hélio em 13/09/2026: um número,
 * um card, enquanto houver conversa aberta, independente da conexão.
 */

export interface BuscaDeCardAberto {
  contactId: number;
  companyId: number;
  whatsappId: number;
  isGroup: boolean;
  /**
   * Gancho para o dia em que uma empresa precisar de um card por conexão de
   * propósito (comercial + suporte em números diferentes). Hoje é sempre
   * `true`; virar um Setting por empresa é trocar este argumento, não a regra.
   */
  unificarConexoes?: boolean;
}

/**
 * Os filtros que distinguem "o card desta pessoa" — sem o status, que o
 * chamador acrescenta porque é um operador do Sequelize.
 *
 * - Conversa 1:1 ignora a conexão e amarra por EMPRESA (o `whatsappId` era o
 *   que amarrava à empresa por tabela; sem ele, `companyId` precisa entrar) e
 *   por canal, para não colidir com o webchat.
 * - GRUPO mantém a conexão: duas conexões da mesma empresa no mesmo grupo são
 *   duas caixas de entrada legítimas. Unir viraria eco.
 */
export function filtroDeCardAberto({
  contactId,
  companyId,
  whatsappId,
  isGroup,
  unificarConexoes = true
}: BuscaDeCardAberto): Record<string, number | string> {
  if (isGroup || !unificarConexoes) {
    return { contactId, companyId, whatsappId };
  }
  return { contactId, companyId, channel: "whatsapp" };
}

/**
 * O card reaproveitado precisa passar para a conexão que recebeu a mensagem?
 *
 * Sim, sempre que for diferente e não for grupo. A resposta do atendente sai
 * pela conexão gravada no card (`GetTicketWbot` lê `ticket.whatsappId`): manter
 * a antiga faria a resposta sair por um número que o cliente não usou — ou não
 * sair, se a conexão estiver caída. Foi exatamente o bug de 09/09/2026.
 *
 * É a linha que o upstream removeu; o caminho do webchat nunca deixou de fazer
 * isso (`FindOrCreateTicketServiceMeta`).
 */
export function precisaMigrarConexao(
  conexaoDoCard: number | null | undefined,
  conexaoDaMensagem: number,
  isGroup: boolean
): boolean {
  if (isGroup) return false;
  return conexaoDoCard !== conexaoDaMensagem;
}
