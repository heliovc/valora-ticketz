import * as crypto from "crypto";

/**
 * Cifra o System User token da Meta guardado em `Whatsapps.cloudApiTokenEnc`.
 *
 * Mesmo algoritmo e MESMO FORMATO do lado Valora
 * (`apps/api/src/modules/integrations/integrations-crypto.util.ts`): AES-256-GCM
 * e `iv:tag:dados` em base64. Manter os dois idênticos é o que permite mover a
 * guarda da credencial de um lado para o outro sem migração de dados.
 *
 * O token da Meta não expira e dá acesso total à conta de WhatsApp da empresa —
 * é a credencial mais sensível deste canal. O código da cifra ser público (o
 * fork é AGPL) não enfraquece nada: o segredo é a chave, que vive só no
 * ambiente.
 */
const ALGO = "aes-256-gcm";

/**
 * Converte `Buffer` para `Uint8Array` sem copiar.
 *
 * A tipagem de `@types/node` usada aqui distingue `Buffer` de
 * `Uint8Array<ArrayBuffer>` e recusa `Buffer` nas APIs de `crypto`. Em tempo de
 * execução são a mesma coisa; isto só resolve a assinatura.
 */
function u8(b: Buffer): Uint8Array {
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}

function getKey(): Uint8Array {
  const raw = process.env.META_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "META_ENCRYPTION_KEY não configurada (32 bytes em hex, 64 caracteres)"
    );
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== 32) {
    throw new Error("META_ENCRYPTION_KEY deve ter 32 bytes (64 caracteres hex)");
  }
  return u8(buf);
}

export function encryptCloudApiToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), u8(iv));
  const enc = Buffer.concat([
    u8(cipher.update(plain, "utf8")),
    u8(cipher.final())
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64")
  ].join(":");
}

export function decryptCloudApiToken(enc: string): string {
  const [ivB64, tagB64, dataB64] = (enc || "").split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Formato de token criptografado inválido");
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    u8(Buffer.from(ivB64, "base64"))
  );
  decipher.setAuthTag(u8(Buffer.from(tagB64, "base64")));
  const dec = Buffer.concat([
    u8(decipher.update(u8(Buffer.from(dataB64, "base64")))),
    u8(decipher.final())
  ]);
  return dec.toString("utf8");
}

/**
 * Compara dois segredos em tempo constante.
 *
 * Comparar com `===` vaza o segredo por timing: quem tenta adivinhar mede
 * quanto tempo a comparação leva e descobre o prefixo correto caractere a
 * caractere. Usado no `verify_token` do webhook e na assinatura HMAC.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a || "", "utf8");
  const bufB = Buffer.from(b || "", "utf8");
  // `timingSafeEqual` exige tamanhos iguais — e o próprio tamanho não é segredo.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(u8(bufA), u8(bufB));
}

/** Igualdade em tempo constante entre dois buffers já prontos. */
export function safeEqualBuffers(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(u8(a), u8(b));
}

/** HMAC-SHA256 hexadecimal do corpo cru, para a assinatura da Meta. */
export function hmacSha256Hex(secret: string, rawBody: Buffer): string {
  return crypto.createHmac("sha256", secret).update(u8(rawBody)).digest("hex");
}
