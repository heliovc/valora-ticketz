import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import { provedoresDaEmpresa } from "../services/AiBotServices/AiBotProvidersService";

/**
 * Transcrição de áudio pelo Gemini (entrada de áudio nativa, sem Whisper).
 *
 * Por que existe: o bot só lê texto, e cliente de casa de festas manda áudio.
 * No canal por QR a transcrição exigia chave da OpenAI (`openAiKey`); no
 * Oficial não existia. Aqui vale o primeiro modelo Gemini da empresa — ou o
 * da Valora, quando a empresa não tem o seu (ver `provedoresDaEmpresa`).
 *
 * Devolve `null` em qualquer impedimento (sem chave, arquivo grande, erro):
 * a mensagem segue como áudio, como sempre foi.
 */
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.AI_BOT_TRANSCRICAO_TIMEOUT_MS || 25000);
const MODELO_COM_AUDIO = process.env.AI_BOT_GEMINI_AUDIO_MODEL || "gemini-2.5-flash";

const MIME_POR_EXTENSAO: Record<string, string> = {
  ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".mp4": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".webm": "audio/webm", ".flac": "audio/flac"
};

export async function transcreverAudioSePossivel(
  companyId: number,
  caminho: string,
  mimeType?: string
): Promise<string | null> {
  try {
    const gemini = (await provedoresDaEmpresa(companyId)).find(p => p.provider === "gemini");
    if (!gemini?.apiKey) return null;
    if (!caminho || !fs.existsSync(caminho)) return null;
    const stat = fs.statSync(caminho);
    if (stat.size === 0 || stat.size > MAX_BYTES) return null;
    const mime = mimeType?.split(";")[0] || MIME_POR_EXTENSAO[path.extname(caminho).toLowerCase()] || "audio/ogg";
    const data = fs.readFileSync(caminho).toString("base64");
    const url = `${process.env.AI_BOT_GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta"}/models/${MODELO_COM_AUDIO}:generateContent`;
    const { data: resposta } = await axios.post(
      url,
      {
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mime, data } },
              { text: "Transcreva este áudio em português do Brasil. Devolva somente a transcrição, sem comentários, sem aspas." }
            ]
          }
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 }
      },
      { headers: { "Content-Type": "application/json", "X-goog-api-key": gemini.apiKey }, timeout: TIMEOUT_MS }
    );
    const texto = (resposta?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p?.text || "")
      .join("")
      .trim();
    if (!texto) return null;
    logger.info({ companyId, bytes: stat.size, chars: texto.length }, "[aiBot] áudio transcrito");
    return texto.slice(0, 4000);
  } catch (err: any) {
    logger.warn({ companyId, message: err?.message }, "[aiBot] transcrição de áudio falhou");
    return null;
  }
}
