import { brNumberVariants } from "../brPhone";
import { extrairAtribuicao } from "../adReferral";
import { hmacSha256Hex, safeEqual, safeEqualBuffers } from "../cloudApiCrypto";

/**
 * Duas coisas que só dá para provar sem a Meta, e que quebram caro em produção:
 * a conta do HMAC (se errar, ou o webhook recusa tudo, ou aceita tudo) e o nono
 * dígito (se errar, contato duplicado ou violação de constraint dentro do
 * webhook).
 */

describe("brNumberVariants — nono dígito", () => {
  it("celular COM o 9 também procura a forma sem", () => {
    expect(brNumberVariants("5511987654321")).toEqual([
      "5511987654321",
      "551187654321"
    ]);
  });

  it("número SEM o 9 também procura a forma com", () => {
    expect(brNumberVariants("551187654321")).toEqual([
      "5511987654321",
      "551187654321"
    ]);
  });

  it("ignora máscara e espaços", () => {
    expect(brNumberVariants("+55 (11) 98765-4321")).toEqual([
      "5511987654321",
      "551187654321"
    ]);
  });

  it("número de fora do Brasil fica como está", () => {
    expect(brNumberVariants("14155552671")).toEqual(["14155552671"]);
  });

  it("vazio devolve lista vazia", () => {
    expect(brNumberVariants("")).toEqual([]);
    expect(brNumberVariants("abc")).toEqual([]);
  });
});

describe("assinatura do webhook", () => {
  const secret = "segredo-do-app-da-meta";
  const corpo = Buffer.from(
    JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    "utf8"
  );

  it("o HMAC bate com o do payload original", () => {
    const assinatura = `sha256=${hmacSha256Hex(secret, corpo)}`;
    const recalculada = `sha256=${hmacSha256Hex(secret, corpo)}`;
    expect(
      safeEqualBuffers(
        Buffer.from(assinatura, "utf8"),
        Buffer.from(recalculada, "utf8")
      )
    ).toBe(true);
  });

  it("um byte alterado no corpo invalida a assinatura", () => {
    const assinatura = hmacSha256Hex(secret, corpo);
    const adulterado = Buffer.from(
      JSON.stringify({ object: "whatsapp_business_account", entry: [1] }),
      "utf8"
    );
    expect(hmacSha256Hex(secret, adulterado)).not.toEqual(assinatura);
  });

  it("segredo errado invalida a assinatura", () => {
    expect(hmacSha256Hex("outro-segredo", corpo)).not.toEqual(
      hmacSha256Hex(secret, corpo)
    );
  });
});

describe("safeEqual", () => {
  it("aceita iguais e recusa diferentes", () => {
    expect(safeEqual("token-certo", "token-certo")).toBe(true);
    expect(safeEqual("token-certo", "token-errado")).toBe(false);
  });

  it("tamanhos diferentes não estouram", () => {
    expect(safeEqual("curto", "bem mais longo")).toBe(false);
  });

  it("vazio nunca casa com segredo de verdade", () => {
    expect(safeEqual("", "segredo")).toBe(false);
  });
});

describe('atribuição de anúncio', () => {
  const referralCompleto = {
    source_id: '120210000000000000',
    source_type: 'ad',
    source_url: 'https://fb.me/abc123',
    headline: 'Clínica sem fila de espera',
    body: 'Agende hoje pelo WhatsApp',
    ctwa_clid: 'ARxYz9_clique_123',
  };

  it('captura os seis campos do anúncio', () => {
    const r = extrairAtribuicao({ referral: referralCompleto });
    expect(r).toEqual({
      referralSourceId: '120210000000000000',
      referralSourceType: 'ad',
      referralSourceUrl: 'https://fb.me/abc123',
      referralHeadline: 'Clínica sem fila de espera',
      referralBody: 'Agende hoje pelo WhatsApp',
      referralCtwaClid: 'ARxYz9_clique_123',
    });
  });

  it('mensagem sem referral é conversa orgânica', () => {
    expect(extrairAtribuicao({ type: 'text', text: { body: 'oi' } })).toBeNull();
    expect(extrairAtribuicao({})).toBeNull();
    expect(extrairAtribuicao(null)).toBeNull();
  });

  it('referral vazio também é orgânico — não inventa origem', () => {
    // A Meta manda `referral: {}` às vezes. Gravar seis nulos faria a conversa
    // aparecer como vinda de anúncio, sem nada para mostrar no cabeçalho.
    expect(extrairAtribuicao({ referral: {} })).toBeNull();
    expect(
      extrairAtribuicao({ referral: { source_id: '', headline: '   ' } }),
    ).toBeNull();
  });

  it('referral parcial grava o que veio e deixa o resto nulo', () => {
    const r = extrairAtribuicao({
      referral: { source_id: '999', source_type: 'post' },
    });
    expect(r?.referralSourceId).toBe('999');
    expect(r?.referralSourceType).toBe('post');
    expect(r?.referralHeadline).toBeNull();
  });

  it('guarda o identificador do clique mesmo sem uso imediato', () => {
    // É o que casa a venda com a campanha depois; não dá para recuperar.
    const r = extrairAtribuicao({ referral: { ctwa_clid: 'clique-abc' } });
    expect(r?.referralCtwaClid).toBe('clique-abc');
  });

  it('valor que não é texto não vira lixo no banco', () => {
    const r = extrairAtribuicao({ referral: { source_id: 12345, headline: 'ok' } });
    expect(r?.referralSourceId).toBeNull();
    expect(r?.referralHeadline).toBe('ok');
  });
});
