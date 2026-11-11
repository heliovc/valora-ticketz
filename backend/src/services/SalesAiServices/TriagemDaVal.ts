import Ticket from "../../models/Ticket";
import { SalesAiConfig } from "../../models/SalesAi";
import { FerramentasDaVal, ferramentasDaVal } from "./FerramentasDaVal";
import { definirProdutoDaTriagem, produtosComPlaybook, promptDeVendas } from "./SalesAiService";
import { TRIAGEM, produtoDaTriagem } from "./salesAiRules";

/**
 * Triagem da Val (pedido do Hélio, 11/11/2026): conversa que entra pela
 * Entrada do funil chega sem produto. A Val primeiro descobre o que a pessoa
 * procura; quando a resposta da triagem traz `[[PRODUTO …]]`, a conversa passa
 * a ser daquele produto e a resposta ao lead é gerada de novo, já com a
 * playbook dele — o lead não recebe a frase da triagem.
 *
 * `gerar` é a chamada à IA de cada canal (Oficial, QR, chat do site), com a
 * persona e as ferramentas que vierem. Ela deve ler `ticket.salesSource` na
 * hora da chamada: depois da triagem, o ticket já está com o produto.
 */
export async function responderComTriagem<R extends { text: string; falha?: boolean }>(
  ticket: Ticket,
  cfg: SalesAiConfig,
  contactId: number,
  gerar: (persona: string, ferramentas: FerramentasDaVal | null) => Promise<R | null>
): Promise<{ resposta: R | null; ferramentas: FerramentasDaVal | null }> {
  if (ticket.salesSource !== TRIAGEM) {
    const ferramentas = await ferramentasDaVal(ticket, cfg);
    const persona = await promptDeVendas(cfg, ticket.salesSource, contactId);
    return { resposta: await gerar(persona, ferramentas), ferramentas };
  }

  // Na triagem não há agenda: marcar demonstração exige saber o produto.
  const triagem = await gerar(await promptDeVendas(cfg, TRIAGEM, contactId), null);
  if (!triagem || triagem.falha) return { resposta: triagem, ferramentas: null };
  const produto = produtoDaTriagem(triagem.text, await produtosComPlaybook(cfg.companyId));
  if (!produto) return { resposta: triagem, ferramentas: null };

  await definirProdutoDaTriagem(ticket, produto);
  const ferramentas = await ferramentasDaVal(ticket, cfg);
  const persona = await promptDeVendas(cfg, produto, contactId);
  return { resposta: await gerar(persona, ferramentas), ferramentas };
}
