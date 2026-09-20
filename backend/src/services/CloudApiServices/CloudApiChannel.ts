import { Op } from "sequelize";
import Whatsapp from "../../models/Whatsapp";
import { decryptCloudApiToken } from "../../helpers/cloudApiCrypto";
import { brNumberVariants } from "../../helpers/brPhone";

export { brNumberVariants };

/**
 * Canal WhatsApp Oficial (Meta Cloud API).
 *
 * Irmão de `whatsapp` (Baileys) e `webchat` (Chat do Site) — não substituto.
 * Este arquivo é a ÚNICA porta de entrada para credencial do canal: nenhum
 * outro lugar lê `cloudApiTokenEnc` direto. É isso que permite trocar a guarda
 * da credencial na fase multi-lojista sem tocar em quem chama.
 */
export const CHANNEL = "whatsapp_official";

/** Versão da Graph API, fixada de propósito: "a mais nova" quebra sem aviso. */
export function graphVersion(): string {
  return process.env.META_GRAPH_VERSION || "v21.0";
}

export function graphUrl(path: string): string {
  return `https://graph.facebook.com/${graphVersion()}/${path.replace(
    /^\//,
    ""
  )}`;
}

/**
 * Acha a conexão pelo `phone_number_id` que veio no webhook.
 *
 * Esta é a chave de roteamento multi-tenant: um App da Meta tem UMA URL de
 * webhook para todas as contas inscritas nele, então é por aqui que se descobre
 * de qual empresa é a mensagem. Nunca usar o id da WABA (`entry[].id`) para
 * isso — uma WABA pode ter vários números.
 */
export async function resolveConnectionByPhoneNumberId(
  phoneNumberId: string
): Promise<Whatsapp | null> {
  if (!phoneNumberId) return null;
  return Whatsapp.findOne({
    where: { cloudApiPhoneNumberId: phoneNumberId, channel: CHANNEL }
  });
}

/** A conexão oficial da empresa (na fase 1 há no máximo uma). */
export async function getCompanyConnection(
  companyId: number
): Promise<Whatsapp | null> {
  return Whatsapp.findOne({
    where: { companyId, channel: CHANNEL },
    order: [["id", "ASC"]]
  });
}

/** Token em claro. Lança se a conexão não tiver credencial gravada. */
export function getToken(whatsapp: Whatsapp): string {
  if (!whatsapp.cloudApiTokenEnc) {
    throw new Error(
      "Conexão do WhatsApp Oficial sem token. Configure em CRM → Canais."
    );
  }
  return decryptCloudApiToken(whatsapp.cloudApiTokenEnc);
}

/** Cláusula `where` que casa qualquer variante do número (com e sem o 9). */
export function numberWhereClause(raw: string) {
  const variantes = brNumberVariants(raw);
  return variantes.length > 1
    ? { number: { [Op.in]: variantes } }
    : { number: variantes[0] || raw };
}
