/**
 * Regras puras do cadastro de mais de um número oficial na mesma conta da
 * Meta (Hélio, 14/11/2026: número só para o Vale Presente, para a qualidade
 * da prospecção não contaminar o número principal).
 */

/** "(21) 97474-4765" ou "+55 21 97474-4765" → { cc: "55", numero: "21974744765" }. */
export function separarNumeroBrasileiro(bruto: string): { cc: string; numero: string } | null {
  let d = String(bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === "0" || d[2] === "0") return null;
  return { cc: "55", numero: d };
}

/** Dígitos para comparar o número que a Meta mostra ("+55 21 97474-4765") com o digitado. */
export function mesmoNumero(daMeta: string, cc: string, numero: string): boolean {
  const a = String(daMeta || "").replace(/\D/g, "");
  const alvo = `${cc}${numero}`;
  if (a === alvo) return true;
  // Celular com e sem o nono dígito.
  const sem9 = (n: string) => (n.length === 13 && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n);
  return sem9(a) === sem9(alvo);
}

/** PIN de 6 dígitos da verificação em duas etapas do número na Cloud API. */
export function pinNovo(aleatorio: (max: number) => number): string {
  let pin = "";
  while (pin.length < 6) pin += String(aleatorio(10));
  // Meta recusa PIN óbvio? Não documentado; evitamos todos iguais por garantia.
  return /^(\d)\1{5}$/.test(pin) ? pinNovo(aleatorio) : pin;
}

/** Nome da conexão (único na tabela inteira): o pedido, ou "WhatsApp <número>". */
export function nomeDaConexao(pedido: string | undefined, exibido: string): string {
  const nome = String(pedido || "").replace(/\s+/g, " ").trim().slice(0, 60);
  return nome || `WhatsApp ${exibido}`.trim();
}
