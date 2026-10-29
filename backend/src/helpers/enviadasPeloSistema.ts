/**
 * Mensagens que o próprio CRM mandou pelo WhatsApp (automação do funil, etc.).
 *
 * O envio com `saveOnTicket` grava a mensagem passando pelo mesmo
 * `handleMessage` das mensagens que chegam do celular — e o WhatsApp ainda
 * devolve o eco dela logo depois. Sem esta marca, o listener via uma mensagem
 * nossa, recente, e concluía "humano digitou no celular": gravava
 * `sentBy = humano` e pausava a Val Vendas por 24 h (abertura da W1 da Valora,
 * 29/10/2026).
 */
const VALIDADE_MS = 10 * 60 * 1000;

const marcadas = new Map<string, { origem: string; ate: number }>();

function limparVencidas(agora: number): void {
  for (const [id, m] of marcadas) if (m.ate <= agora) marcadas.delete(id);
}

export function marcarEnvioDoSistema(
  messageId: string | null | undefined,
  origem: string,
  agora: number = Date.now()
): void {
  if (!messageId) return;
  limparVencidas(agora);
  marcadas.set(messageId, { origem, ate: agora + VALIDADE_MS });
}

/** Quem enviou, se foi o CRM (`automacao`, `sistema`...); `null` = não sabemos. */
export function origemDoEnvio(
  messageId: string | null | undefined,
  agora: number = Date.now()
): string | null {
  if (!messageId) return null;
  const m = marcadas.get(messageId);
  if (!m) return null;
  if (m.ate <= agora) {
    marcadas.delete(messageId);
    return null;
  }
  return m.origem;
}
