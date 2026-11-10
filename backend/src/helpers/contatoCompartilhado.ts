/**
 * Contato compartilhado pelo WhatsApp Oficial (mensagem `type: "contacts"`).
 *
 * Antes o CRM guardava só "👤 Contato recebido" e jogava fora o nome e o
 * telefone — e a Meta não deixa buscar a mensagem de novo depois. Foi assim
 * que se perdeu o contato do responsável que o Casarão do Alcântara mandou em
 * 10/11/2026. Agora o texto da mensagem já traz quem é e o número, e a Val lê
 * o mesmo texto no histórico.
 *
 * Formato da Meta: `contacts: [{ name: { formatted_name, first_name, ... },
 * phones: [{ phone, wa_id, type }], emails: [{ email }], org: { company } }]`.
 */

function nomeDoContato(c: any): string {
  const n = c?.name || {};
  return (
    n.formatted_name ||
    [n.first_name, n.middle_name, n.last_name].filter(Boolean).join(" ") ||
    ""
  ).trim();
}

function telefonesDoContato(c: any): string[] {
  const fones = (Array.isArray(c?.phones) ? c.phones : [])
    .map((p: any) => String(p?.phone || p?.wa_id || "").trim())
    .filter(Boolean);
  return [...new Set<string>(fones)];
}

/** Uma linha por contato: "Pedro — +55 21 99999-0000 (empresa, e-mail)". */
export function descreverContatoCompartilhado(msg: any): string {
  const contatos: any[] = Array.isArray(msg?.contacts) ? msg.contacts : [];
  const linhas = contatos
    .map(c => {
      const nome = nomeDoContato(c);
      const fones = telefonesDoContato(c);
      const extras = [
        c?.org?.company,
        ...(Array.isArray(c?.emails) ? c.emails.map((e: any) => e?.email) : [])
      ].filter(Boolean);
      const base = [nome, fones.join(", ")].filter(Boolean).join(" — ");
      if (!base) return "";
      return extras.length ? `${base} (${extras.join(", ")})` : base;
    })
    .filter(Boolean);

  if (!linhas.length) return "👤 Contato recebido (sem nome nem telefone)";
  return linhas.length === 1
    ? `👤 Contato: ${linhas[0]}`
    : `👤 Contatos:\n${linhas.map(l => `• ${l}`).join("\n")}`;
}
