/**
 * De qual anúncio veio a conversa.
 *
 * Quando alguém clica num anúncio de "clique para o WhatsApp", a Meta manda um
 * objeto `referral` junto com a PRIMEIRA mensagem daquele clique. A segunda já
 * vem sem nada, e não há como perguntar depois — por isso é gravado no ato.
 *
 * Fica num helper puro, sem model nem banco, para poder ser testado sozinho: é
 * a classe de código que só quebraria com um anúncio real rodando.
 */

export interface AtribuicaoDeAnuncio {
  referralSourceId: string | null;
  referralSourceType: string | null;
  referralSourceUrl: string | null;
  referralHeadline: string | null;
  referralBody: string | null;
  /**
   * Identificador do clique. Não aparece na tela: serve para casar a venda com
   * a campanha no gerenciador da Meta depois. Guardado mesmo sem uso imediato,
   * porque não dá para recuperar.
   */
  referralCtwaClid: string | null;
}

/** `null` = conversa orgânica, e aí nada é escrito no ticket. */
export function extrairAtribuicao(msg: unknown): AtribuicaoDeAnuncio | null {
  const r = (msg as { referral?: Record<string, unknown> } | null)?.referral;
  if (!r || typeof r !== "object") return null;

  const texto = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;

  const campos: AtribuicaoDeAnuncio = {
    referralSourceId: texto(r.source_id),
    referralSourceType: texto(r.source_type),
    referralSourceUrl: texto(r.source_url),
    referralHeadline: texto(r.headline),
    referralBody: texto(r.body),
    referralCtwaClid: texto(r.ctwa_clid)
  };

  // A Meta às vezes manda `referral: {}`. Gravar seis nulos faria a conversa
  // parecer vinda de anúncio no cabeçalho, sem nada para mostrar.
  const temAlgo = Object.values(campos).some(v => v !== null);
  return temAlgo ? campos : null;
}
