import { Op } from "sequelize";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import Message from "../../models/Message";
import { logger } from "../../utils/logger";

/**
 * Fotos e vídeos que a empresa subiu (na Valora: Eventos → Configuração do
 * espaço) e que o bot envia no atendimento (10/11/2026).
 *
 * A Valora grava a lista na chave `aiBotMidias` — [{codigo, tipo, legenda,
 * url, mime}] — e o bot pede com um comando no meio da resposta:
 *
 *   [[ENVIAR_MIDIA codigos="F1,F3"]]
 *
 * O CRM tira o comando do texto e envia os arquivos pelo canal do card, depois
 * do texto. O chat do site não mostra mídia: lá vão os links.
 */

export type MidiaDoBot = { codigo: string; tipo: "foto" | "video"; legenda: string; url: string; mime: string };

const CHAVE = "aiBotMidias";
export const MAX_POR_RESPOSTA = 4;
const MARCADOR = /\[\[\s*ENVIAR_MIDIA\b([^\]]*)\]\]/gi;

/** Lista da empresa; vazia quando não há nada (ou a chave está quebrada). */
export async function midiasDaEmpresa(companyId: number): Promise<MidiaDoBot[]> {
  const bruto = await GetCompanySetting(companyId, CHAVE, "[]");
  return lerMidias(bruto);
}

export function lerMidias(bruto: string | null | undefined): MidiaDoBot[] {
  try {
    const lista = JSON.parse(bruto || "[]");
    if (!Array.isArray(lista)) return [];
    return lista
      .filter(m => m && /^[FV]\d{1,3}$/.test(String(m.codigo)) && /^https?:\/\//.test(String(m.url)))
      .map(m => ({
        codigo: String(m.codigo),
        tipo: m.tipo === "video" ? "video" : "foto",
        legenda: String(m.legenda || "").slice(0, 200),
        url: String(m.url),
        mime: String(m.mime || (m.tipo === "video" ? "video/mp4" : "image/jpeg"))
      }));
  } catch {
    return [];
  }
}

/** Bloco do prompt: o que existe, o que já foi enviado e como pedir. Vazio sem mídia. */
export function blocoDeMidias(midias: MidiaDoBot[], jaEnviadas: Set<string>): string {
  if (!midias.length) return "";
  return [
    "FOTOS E VÍDEOS DO ESPAÇO — o sistema envia ao cliente pelo próprio chat:",
    ...midias.map(
      m => `- ${m.codigo}: ${m.legenda} (${m.tipo === "video" ? "vídeo" : "foto"})${jaEnviadas.has(m.url) ? " — já enviado nesta conversa" : ""}`
    ),
    `Comando: [[ENVIAR_MIDIA codigos="F1,F2"]] — até ${MAX_POR_RESPOSTA} por resposta, escolhidos pela legenda.`,
    "Use quando o cliente pedir fotos ou vídeos, ou quando ajudar (ex.: perguntou como é o salão). Escreva junto uma frase curta (\"Seguem fotos do salão!\"): os arquivos chegam logo depois do seu texto.",
    "Nunca diga que não tem fotos ou vídeos. Não reenvie o que já foi enviado, a não ser que o cliente peça de novo."
  ].join("\n");
}

/** Tira os comandos do texto e devolve os códigos pedidos (sem repetir, na ordem). */
export function extrairPedidoDeMidias(texto: string): { texto: string; codigos: string[] } {
  const codigos: string[] = [];
  const limpo = String(texto || "").replace(MARCADOR, (_m, args: string) => {
    const valor = /codigos?\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i.exec(args || "");
    const lista = (valor ? valor[1] ?? valor[2] ?? valor[3] : args || "").toUpperCase().match(/[FV]\d{1,3}/g) || [];
    for (const c of lista) if (!codigos.includes(c)) codigos.push(c);
    return "";
  });
  return { texto: limpo.replace(/\n{3,}/g, "\n\n").trim(), codigos };
}

/** Os itens pedidos que existem, no máximo `MAX_POR_RESPOSTA`. */
export function escolherMidias(midias: MidiaDoBot[], codigos: string[]): MidiaDoBot[] {
  return codigos
    .map(c => midias.find(m => m.codigo === c))
    .filter((m): m is MidiaDoBot => Boolean(m))
    .slice(0, MAX_POR_RESPOSTA);
}

/** Links das mídias que já saíram neste ticket (como arquivo ou como link no texto). */
export async function midiasJaEnviadas(ticketId: number, midias: MidiaDoBot[]): Promise<Set<string>> {
  if (!midias.length) return new Set();
  const urls = midias.map(m => m.url);
  try {
    const enviadas = await Message.findAll({
      where: {
        ticketId,
        fromMe: true,
        [Op.or]: [{ mediaUrl: { [Op.in]: urls } }, ...urls.map(u => ({ body: { [Op.like]: `%${u}%` } }))]
      } as any,
      attributes: ["body", "mediaUrl"],
      limit: 200
    });
    const ja = new Set<string>();
    for (const e of enviadas) {
      for (const u of urls) {
        if ((e as any).getDataValue?.("mediaUrl") === u || (e as any).mediaUrl === u || String(e.body || "").includes(u)) ja.add(u);
      }
    }
    return ja;
  } catch (err) {
    logger.warn({ err, ticketId }, "[aiBot] não deu para ler as mídias já enviadas");
    return new Set();
  }
}

/** Para o chat do site (sem mídia) e para o envio que falhou: a legenda com o link. */
export function linhaDeLink(m: MidiaDoBot): string {
  return `${m.tipo === "video" ? "🎬" : "📷"} ${m.legenda}: ${m.url}`;
}
