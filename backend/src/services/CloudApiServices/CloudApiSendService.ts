import axios from "axios";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { getToken, graphUrl } from "./CloudApiChannel";

/**
 * Envio pelo WhatsApp Oficial (Meta Cloud API).
 *
 * Diferença que mais pega quem vem do Baileys: **a janela de 24 horas**. Passadas
 * 24h desde a última mensagem DO CLIENTE, a Meta recusa texto livre; só aceita
 * template aprovado por ela. Não é limite nosso, é regra da plataforma.
 */

/**
 * Margem de segurança sobre as 24h: quem manda no relógio é a Meta, e estourar
 * por dois minutos vira erro 131047 em produção.
 */
const JANELA_MS = 23.5 * 60 * 60 * 1000;

export interface EnvioResultado {
  /** `wamid...` devolvido pela Meta — vira o id da Message. */
  wamid: string;
}

/** A conversa aceita texto livre agora? */
export function dentroDaJanela(ticket: Ticket): boolean {
  if (!ticket.lastInboundAt) return false;
  const marca = new Date(ticket.lastInboundAt).getTime();
  return Date.now() - marca < JANELA_MS;
}

/**
 * Traduz o erro da Graph API para algo que o atendente entenda.
 *
 * A Meta devolve `{ error: { message, code, error_subcode } }` com texto em
 * inglês e jargão próprio. Repassar isso cru foi o que, no Baileys, fez uma
 * conexão caída chegar ao usuário como "erro no proxy do CRM".
 */
function traduzErro(err: any): string {
  const meta = err?.response?.data?.error;
  const codigo = Number(meta?.code);

  if (codigo === 131047 || codigo === 470) {
    return "Passaram mais de 24 horas desde a última mensagem do cliente. Nesse caso o WhatsApp só aceita um modelo de mensagem aprovado — peça para o cliente escrever primeiro, ou use uma cobrança.";
  }
  if (codigo === 131026) {
    return "O WhatsApp não conseguiu entregar: o número pode não ter WhatsApp ou não aceitar mensagens desta conta.";
  }
  if (codigo === 131051) {
    return "Tipo de mensagem não suportado por este canal.";
  }
  if (codigo === 190 || codigo === 102) {
    return "A credencial do WhatsApp Oficial expirou ou foi revogada. Reconfigure em CRM → Canais.";
  }
  if (codigo === 4 || codigo === 80007 || codigo === 130429) {
    return "Limite de envio da Meta atingido. Tente de novo em alguns minutos.";
  }
  if (meta?.message) return `WhatsApp recusou o envio: ${meta.message}`;
  if (err?.code === "ECONNABORTED") {
    return "O WhatsApp não respondeu a tempo. Tente de novo.";
  }
  return "Falha ao enviar pelo WhatsApp Oficial.";
}

async function postMessage(
  whatsapp: Whatsapp,
  payload: Record<string, unknown>
): Promise<EnvioResultado> {
  const token = getToken(whatsapp);
  try {
    const { data } = await axios.post(
      graphUrl(`${whatsapp.cloudApiPhoneNumberId}/messages`),
      { messaging_product: "whatsapp", recipient_type: "individual", ...payload },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000
      }
    );
    const wamid = data?.messages?.[0]?.id;
    if (!wamid) {
      throw new AppError("O WhatsApp aceitou a mensagem mas não devolveu o identificador.");
    }
    return { wamid };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    logger.error(
      {
        status: err?.response?.status,
        data: err?.response?.data,
        phoneNumberId: whatsapp.cloudApiPhoneNumberId
      },
      "CloudApi: falha no envio"
    );
    throw new AppError(traduzErro(err), 400);
  }
}

/** Texto livre — só funciona dentro da janela de 24h. */
export async function sendText(
  whatsapp: Whatsapp,
  to: string,
  body: string
): Promise<EnvioResultado> {
  return postMessage(whatsapp, {
    to: (to || "").replace(/\D/g, ""),
    type: "text",
    text: { preview_url: true, body }
  });
}

/**
 * Template aprovado — o único caminho fora da janela de 24h.
 *
 * `params` são POSICIONAIS (`{{1}}`, `{{2}}`...), na ordem em que aparecem no
 * corpo aprovado. Nenhum parâmetro pode conter quebra de linha, tabulação ou
 * quatro espaços seguidos: a Meta rejeita.
 */
export async function sendTemplate(
  whatsapp: Whatsapp,
  to: string,
  templateName: string,
  language: string,
  params: string[]
): Promise<EnvioResultado> {
  const components = params.length
    ? [
        {
          type: "body",
          parameters: params.map(text => ({ type: "text", text }))
        }
      ]
    : [];

  return postMessage(whatsapp, {
    to: (to || "").replace(/\D/g, ""),
    type: "template",
    template: {
      name: templateName,
      language: { code: language || "pt_BR" },
      ...(components.length ? { components } : {})
    }
  });
}

/**
 * Marca como lida no celular do cliente (os dois tiques azuis do lado dele).
 * Falha aqui é cosmética — nunca deve derrubar o atendimento.
 */
export async function markAsRead(
  whatsapp: Whatsapp,
  wamid: string
): Promise<void> {
  try {
    const token = getToken(whatsapp);
    await axios.post(
      graphUrl(`${whatsapp.cloudApiPhoneNumberId}/messages`),
      { messaging_product: "whatsapp", status: "read", message_id: wamid },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
  } catch (err: any) {
    logger.debug(
      { message: err?.message },
      "CloudApi: não deu para marcar como lida (ignorado)"
    );
  }
}
