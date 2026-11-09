/**
 * Encodes a string for use in a URL, while preserving certain characters.
 * This function encodes the string using encodeURIComponent,
 * but then replaces specific encoded characters
 * to ensure they remain intact.
 *
 * @param {string} str - The string to encode.
 * @return {string} - The encoded string with specific characters preserved.
 */
export function URLCharEncoder(str) {
  return encodeURIComponent(str)
    .replace(/%2F/g, "/")
    .replace(/%3A/g, ":")
    .replace(/%2E/g, ".");
}

/**
 * Link externo (https://…) gravado como mídia: codifica como acima, mas mantém
 * a consulta (`?`, `=`, `&`). Sem isso, o vídeo da Val gravado com `?v=…`
 * virava `%3Fv%3D…`, o site devolvia 404 e o CRM mostrava "mídia
 * indisponível", embora o lead tivesse recebido o vídeo (09/11/2026). A tabela
 * em PDF depende da `?chave=` e quebrava do mesmo jeito.
 */
export function URLExternaEncoder(str: string): string {
  return URLCharEncoder(str)
    .replace(/%3F/g, "?")
    .replace(/%3D/g, "=")
    .replace(/%26/g, "&");
}

