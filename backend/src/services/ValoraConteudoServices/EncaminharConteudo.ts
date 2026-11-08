import axios from "axios";
import { logger } from "../../utils/logger";

/**
 * Ponte do WhatsApp Oficial com a consultora virtual do Conteúdo IA (Valora).
 *
 * A dona da loja conversa com a consultora pelo WhatsApp; quem entende e
 * responde é a Valora (dados da loja, produtos e posts moram lá). Este motor só
 * repassa a mensagem e devolve o que a Valora mandar enviar.
 *
 * Falha aberta: se a Valora não responder em poucos segundos, a mensagem segue
 * o fluxo normal da conexão (bot, funil, atendente). Melhor a dona cair no
 * atendimento comum do que a mensagem de um cliente sumir.
 */

export type ModoConteudo = "off" | "autorizados" | "todos";

export function modoDaConexao(whatsapp: { valoraConteudoIa?: string | null }): ModoConteudo {
  const m = String(whatsapp?.valoraConteudoIa || "off");
  return m === "autorizados" || m === "todos" ? m : "off";
}

export interface MidiaRecebida {
  mediaUrl: string;
  mediaType: string;
  filename: string;
}

export interface Encaminhamento {
  wamid: string;
  modo: ModoConteudo;
  whatsappId: number;
  companyId: number;
  ticketId: number;
  contactId: number;
  from: string;
  profileName: string;
  type: string;
  text: string;
  buttonId: string | null;
  listId: string | null;
  mediaPath: string | null;
  mimeType: string | null;
  filename: string | null;
  timestamp: number;
}

/** Monta o que vai para a Valora. Função pura, testada. */
export function montarEncaminhamento(args: {
  whatsapp: { id: number; companyId: number; valoraConteudoIa?: string | null };
  ticketId: number;
  contactId: number;
  value: any;
  msg: any;
  midia: MidiaRecebida | null;
}): Encaminhamento {
  const { whatsapp, ticketId, contactId, value, msg, midia } = args;
  const tipo: string = msg?.type || "unknown";
  const texto =
    tipo === "text"
      ? msg?.text?.body || ""
      : tipo === "button"
        ? msg?.button?.text || ""
        : tipo === "interactive"
          ? msg?.interactive?.button_reply?.title || msg?.interactive?.list_reply?.title || ""
          : msg?.[tipo]?.caption || "";
  return {
    wamid: String(msg?.id || ""),
    modo: modoDaConexao(whatsapp),
    whatsappId: whatsapp.id,
    companyId: whatsapp.companyId,
    ticketId,
    contactId,
    from: String(msg?.from || "").replace(/\D/g, ""),
    profileName: value?.contacts?.[0]?.profile?.name || "",
    type: tipo,
    text: texto,
    // O id do botão é o que diz QUAL botão: o título se repete entre cartões.
    buttonId: msg?.interactive?.button_reply?.id || msg?.button?.payload || null,
    listId: msg?.interactive?.list_reply?.id || null,
    mediaPath: midia?.mediaUrl || null,
    mimeType: midia ? msg?.[tipo]?.mime_type || null : null,
    filename: midia?.filename || null,
    timestamp: Number(msg?.timestamp) > 0 ? Number(msg.timestamp) * 1000 : Date.now()
  };
}

/**
 * Pergunta à Valora se a mensagem é da consultora. `true` = a Valora assumiu e
 * este motor não deve acionar bot nem funil para ela.
 */
export async function encaminharParaValora(dados: Encaminhamento): Promise<boolean> {
  if (dados.modo === "off" || !dados.wamid) return false;
  const base = process.env.VALORA_INTERNAL_URL;
  const segredo = process.env.VALORA_INTERNAL_SECRET;
  if (!base || !segredo) {
    logger.error("[conteudo] VALORA_INTERNAL_URL ou VALORA_INTERNAL_SECRET ausente — mensagem segue o fluxo normal");
    return false;
  }
  try {
    const { data } = await axios.post(`${base.replace(/\/$/, "")}/internal/conteudo/inbound`, dados, {
      headers: { "x-internal-secret": segredo },
      timeout: Number(process.env.VALORA_CONTEUDO_TIMEOUT_MS) || 4000
    });
    return data?.handled === true;
  } catch (err: any) {
    logger.warn(
      { wamid: dados.wamid, status: err?.response?.status, message: err?.message },
      "[conteudo] Valora não respondeu — mensagem segue o fluxo normal"
    );
    return false;
  }
}
