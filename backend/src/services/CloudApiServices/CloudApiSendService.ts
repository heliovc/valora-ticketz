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
 * Imagem com legenda. Sobe o arquivo para a Meta antes (endpoint `media`) —
 * assim não precisa de URL pública, e a imagem da simulação de um cliente não
 * fica exposta num endereço aberto.
 */
export async function sendImage(
  whatsapp: Whatsapp,
  to: string,
  imagem: Buffer,
  legenda: string
): Promise<EnvioResultado> {
  const token = getToken(whatsapp);
  let mediaId: string;
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "image/jpeg");
    form.append("file", new Blob([new Uint8Array(imagem)], { type: "image/jpeg" }), "simulacao.jpg");
    const { data } = await axios.post(
      graphUrl(`${whatsapp.cloudApiPhoneNumberId}/media`),
      form,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    mediaId = data?.id;
    if (!mediaId) throw new Error("a Meta não devolveu o id da mídia");
  } catch (err: any) {
    logger.error(
      { status: err?.response?.status, data: err?.response?.data },
      "CloudApi: falha ao subir imagem"
    );
    throw new AppError(traduzErro(err), 400);
  }
  return postMessage(whatsapp, {
    to: (to || "").replace(/\D/g, ""),
    type: "image",
    image: { id: mediaId, caption: legenda.slice(0, 1024) }
  });
}

/**
 * Vídeo por link público, com legenda. A Meta baixa o arquivo do endereço:
 * serve para o vídeo de demonstração, que já é público no site. MP4 (H.264 e
 * AAC), até 16 MB.
 */
export async function sendVideo(
  whatsapp: Whatsapp,
  to: string,
  link: string,
  legenda: string
): Promise<EnvioResultado> {
  return postMessage(whatsapp, montarVideo(to, link, legenda));
}

/** Corpo do envio de vídeo, separado para teste. */
export function montarVideo(to: string, link: string, legenda: string): Record<string, unknown> {
  return {
    to: (to || "").replace(/\D/g, ""),
    type: "video",
    video: { link, ...(legenda ? { caption: legenda.slice(0, 1024) } : {}) }
  };
}

export interface Botao {
  id: string;
  title: string;
}

export interface SecaoDaLista {
  title?: string;
  rows: { id: string; title: string; description?: string }[];
}

/** Limites da Meta para mensagem interativa: o envio é recusado acima disso. */
const LIMITE = { botoes: 3, tituloBotao: 20, corpo: 1024, linhas: 10, tituloLinha: 24, descricao: 72, botaoLista: 20, id: 200 };

const corta = (s: string, n: number) => (s || "").trim().slice(0, n);

/**
 * Botões de resposta rápida (até 3). Corpo separado para teste. Só dentro da
 * janela de 24h — fora dela, só template.
 */
export function montarBotoes(to: string, texto: string, botoes: Botao[]): Record<string, unknown> {
  if (!botoes.length || botoes.length > LIMITE.botoes) {
    throw new AppError(`Mensagem com botões precisa de 1 a ${LIMITE.botoes} botões.`);
  }
  return {
    to: (to || "").replace(/\D/g, ""),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: corta(texto, LIMITE.corpo) },
      action: {
        buttons: botoes.map(b => ({
          type: "reply",
          reply: { id: corta(b.id, LIMITE.id), title: corta(b.title, LIMITE.tituloBotao) }
        }))
      }
    }
  };
}

/** Lista de opções (até 10 linhas no total). Corpo separado para teste. */
export function montarLista(to: string, texto: string, botao: string, secoes: SecaoDaLista[]): Record<string, unknown> {
  const total = secoes.reduce((n, s) => n + s.rows.length, 0);
  if (!total || total > LIMITE.linhas) {
    throw new AppError(`Lista precisa de 1 a ${LIMITE.linhas} opções.`);
  }
  return {
    to: (to || "").replace(/\D/g, ""),
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: corta(texto, LIMITE.corpo) },
      action: {
        button: corta(botao, LIMITE.botaoLista),
        sections: secoes.map(s => ({
          ...(s.title ? { title: corta(s.title, LIMITE.tituloLinha) } : {}),
          rows: s.rows.map(r => ({
            id: corta(r.id, LIMITE.id),
            title: corta(r.title, LIMITE.tituloLinha),
            ...(r.description ? { description: corta(r.description, LIMITE.descricao) } : {})
          }))
        }))
      }
    }
  };
}

export async function sendButtons(whatsapp: Whatsapp, to: string, texto: string, botoes: Botao[]): Promise<EnvioResultado> {
  return postMessage(whatsapp, montarBotoes(to, texto, botoes));
}

export async function sendList(
  whatsapp: Whatsapp,
  to: string,
  texto: string,
  botao: string,
  secoes: SecaoDaLista[]
): Promise<EnvioResultado> {
  return postMessage(whatsapp, montarLista(to, texto, botao, secoes));
}

/**
 * Imagem, vídeo ou documento a partir dos bytes: sobe para a Meta (`/media`) e
 * envia pelo id. Não depende de URL pública.
 */
export async function sendMediaBuffer(
  whatsapp: Whatsapp,
  to: string,
  tipo: "image" | "video" | "document",
  arquivo: Buffer,
  mimeType: string,
  filename: string,
  legenda: string
): Promise<EnvioResultado> {
  const token = getToken(whatsapp);
  let mediaId: string;
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([new Uint8Array(arquivo)], { type: mimeType }), filename || "arquivo");
    const { data } = await axios.post(graphUrl(`${whatsapp.cloudApiPhoneNumberId}/media`), form, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 60000,
      maxBodyLength: 100 * 1024 * 1024
    });
    mediaId = data?.id;
    if (!mediaId) throw new Error("a Meta não devolveu o id da mídia");
  } catch (err: any) {
    logger.error({ status: err?.response?.status, data: err?.response?.data, tipo }, "CloudApi: falha ao subir mídia");
    throw new AppError(traduzErro(err), 400);
  }
  const conteudo: Record<string, unknown> = { id: mediaId };
  if (legenda) conteudo.caption = legenda.slice(0, 1024);
  if (tipo === "document" && filename) conteudo.filename = filename;
  return postMessage(whatsapp, { to: (to || "").replace(/\D/g, ""), type: tipo, [tipo]: conteudo });
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
