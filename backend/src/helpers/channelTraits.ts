/**
 * Predicados de canal.
 *
 * Existem porque, historicamente, `channel === "whatsapp"` significa DUAS
 * coisas ao mesmo tempo no código: "é WhatsApp" e "é Baileys". Enquanto havia
 * um só canal de WhatsApp isso não incomodava; com o canal oficial ao lado,
 * cada uma dessas comparações precisa dizer qual das duas quer.
 *
 * A conversão é deliberadamente parcial: só os pontos que o canal oficial
 * atravessa foram trocados. Onde a intenção É Baileys (QR Code, reiniciar
 * sessão, VoIP), `=== "whatsapp"` continua certo e foi deixado como está —
 * trocar por trocar seria refatoração sem cliente.
 */

export const CANAL_BAILEYS = "whatsapp";
export const CANAL_OFICIAL = "whatsapp_official";
export const CANAL_WEBCHAT = "webchat";

/** É a conexão não-oficial, por QR Code? */
export function isBaileys(channel?: string | null): boolean {
  return (channel || CANAL_BAILEYS) === CANAL_BAILEYS;
}

/** É o WhatsApp Oficial da Meta (Cloud API)? */
export function isOficial(channel?: string | null): boolean {
  return channel === CANAL_OFICIAL;
}

/** É WhatsApp, por qualquer das duas vias? */
export function isWhatsApp(channel?: string | null): boolean {
  return isBaileys(channel) || isOficial(channel);
}
