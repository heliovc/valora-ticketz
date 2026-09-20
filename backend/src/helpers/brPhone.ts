/**
 * Números brasileiros com e sem o nono dígito.
 *
 * A Meta entrega o `wa_id` do Brasil muitas vezes SEM o 9
 * (`551187654321`), enquanto o Baileys costuma gravar COM
 * (`5511987654321`). Como `Contact.number` é único, tratar as duas formas como
 * números diferentes dá, no melhor caso, dois contatos para a mesma pessoa; no
 * pior, violação de constraint dentro do webhook, em produção.
 *
 * Fica num helper puro, sem model nem banco, para poder ser testado sozinho —
 * é a classe de erro que só aparece com número real.
 */

/**
 * Formas possíveis do mesmo número, da mais longa para a mais curta.
 *
 * A forma COM o 9 vem primeiro de propósito: é a que o Baileys mais grava, e
 * procurar por ela primeiro reaproveita o contato que já existe em vez de criar
 * um segundo.
 */
export function brNumberVariants(raw: string): string[] {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return [];

  const variantes = new Set<string>([digits]);

  if (digits.startsWith("55")) {
    const resto = digits.slice(2);
    const ddd = resto.slice(0, 2);
    const assinante = resto.slice(2);

    if (assinante.length === 8) {
      // Fixo ou celular antigo escrito sem o nono dígito → acrescenta.
      variantes.add(`55${ddd}9${assinante}`);
    } else if (assinante.length === 9 && assinante.startsWith("9")) {
      // Celular com o nono dígito → também procura sem.
      variantes.add(`55${ddd}${assinante.slice(1)}`);
    }
  }

  return [...variantes].sort((a, b) => b.length - a.length);
}
