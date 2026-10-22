import axios from "axios";
import mime from "mime-types";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import saveMediaToFile from "../../helpers/saveMediaFile";
import { logger } from "../../utils/logger";
import { getToken, graphUrl } from "./CloudApiChannel";

export const TIPOS_DE_MIDIA = ["image", "audio", "video", "document", "sticker"];

export function rotuloDaMidia(tipo: string): string {
  switch (tipo) {
    case "image":
      return "Imagem";
    case "audio":
      return "Áudio";
    case "video":
      return "Vídeo";
    case "sticker":
      return "Figurinha";
    default:
      return "Documento";
  }
}

export interface MidiaBaixada {
  mediaUrl: string;
  /** `image` / `audio` / `video` / `application`, como o canal por QR grava. */
  mediaType: string;
  filename: string;
}

/**
 * Baixa a mídia que a Meta entregou e grava em `public/`, no mesmo formato do
 * canal por QR Code — assim o painel mostra a imagem em vez de "abra no celular".
 *
 * A Graph entrega em dois passos: `GET /{media_id}` devolve a URL assinada e o
 * mime; `GET url` (com o mesmo token) devolve o binário. A URL vale minutos,
 * por isso o download acontece na hora do webhook.
 *
 * Nunca lança: falhar aqui não pode derrubar a mensagem — o atendente ainda
 * precisa saber que algo chegou. Quem chama trata `null` como "não deu".
 */
export async function baixarMidiaDaMeta(
  whatsapp: Whatsapp,
  msg: any,
  ticket: Ticket
): Promise<MidiaBaixada | null> {
  const info = msg?.[msg?.type];
  const mediaId: string | undefined = info?.id;
  if (!mediaId) return null;
  try {
    const token = getToken(whatsapp);
    const meta = await axios.get(graphUrl(mediaId), {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    const url: string | undefined = meta.data?.url;
    if (!url) {
      logger.warn({ mediaId }, "CloudApi: Graph não devolveu URL da mídia");
      return null;
    }
    const mimetype: string = String(
      meta.data?.mime_type || info?.mime_type || "application/octet-stream"
    ).split(";")[0];
    const bin = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: "arraybuffer",
      timeout: 60000,
      // A Meta limita mídia a 100 MB; acima disso é erro, não download.
      maxContentLength: 100 * 1024 * 1024
    });
    const ext = mime.extension(mimetype) || "bin";
    const filename: string = info?.filename || `${Date.now()}.${ext}`;
    const mediaUrl = await saveMediaToFile(
      { data: Buffer.from(bin.data), mimetype, filename },
      { destination: ticket }
    );
    return { mediaUrl, mediaType: mimetype.split("/")[0], filename };
  } catch (err: any) {
    logger.warn(
      { mediaId, tipo: msg?.type, message: err?.message, status: err?.response?.status },
      "CloudApi: falha ao baixar mídia"
    );
    return null;
  }
}
