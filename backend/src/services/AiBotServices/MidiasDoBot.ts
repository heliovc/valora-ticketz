import { Op } from "sequelize";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import Message from "../../models/Message";
import { logger } from "../../utils/logger";
import { tipoCitado } from "./consultaDaAgenda";

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
    "Nunca diga que não tem fotos ou vídeos, e nunca mande o cliente ver fotos no Instagram, site ou redes sociais: as fotos estão aqui. Não reenvie o que já foi enviado, a não ser que o cliente peça de novo."
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Rede de segurança (10/11/2026): o modelo grátis da demo respondeu   */
/* "não tenho fotos, veja no Instagram" com a lista no prompt. Quando  */
/* o cliente pede fotos e o modelo não manda, o sistema manda.         */
/* ------------------------------------------------------------------ */

const normalizar = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const COMANDO = /\[\[[^\]]*\]\]/g;
const TEM_PEDIDO = /\[\[\s*ENVIAR_MIDIA\b/i;
const FRASE_FOTOS = "Seguem algumas fotos do espaço:";
const FRASE_COM_VIDEO = "Seguem fotos e vídeo do espaço:";

/** O cliente pediu para VER fotos/vídeos? ("posso tirar fotos", fotógrafo e filmagem não contam.) */
export function pedidoDoCliente(mensagem: string): { fotos: boolean; video: boolean } {
  const t = normalizar(mensagem);
  if (/\btirar fotos?\b|\bfotograf|\bfilmag|\bfilmar\b/.test(t)) return { fotos: false, video: false };
  const video = /\b(videos?|tour)\b/.test(t);
  const fotos =
    video ||
    /\b(fotos?|fotinhas?|imagens?)\b/.test(t) ||
    /\bver como (e|eh|fica|sao) (o|a|os|as) (espaco|salao|saloes|lugar|local|casa)\b/.test(t);
  return { fotos, video };
}

const TIPOS: Record<string, RegExp> = {
  casamento: /casamento|noiv|cerimonia|bodas/,
  "15_anos": /15 anos|quinze|debutante/,
  infantil: /infantil|kids|crianca|brinquedo/
};
const tipoDaLegenda = (m: MidiaDoBot) => Object.keys(TIPOS).find(k => TIPOS[k].test(normalizar(m.legenda)));

/**
 * Até `MAX_POR_RESPOSTA` itens para o pedido: os do tipo de festa da conversa
 * primeiro, depois os gerais (salão, tour); sem tipo conhecido, um de cada.
 * Vídeo só entra na frente quando o cliente pediu vídeo. O que já foi enviado
 * fica de fora — se tudo já foi, o cliente está pedindo de novo e recebe de novo.
 */
export function midiasParaOPedido(
  midias: MidiaDoBot[],
  jaEnviadas: Set<string>,
  opts: { tipo?: string; video: boolean }
): MidiaDoBot[] {
  const novas = midias.filter(m => !jaEnviadas.has(m.url));
  const base = novas.length ? novas : midias;
  const nota = (m: MidiaDoBot) => {
    const tipo = tipoDaLegenda(m);
    let n = opts.tipo && tipo === opts.tipo ? 2 : tipo ? 0 : 1;
    if (m.tipo === "video") n += opts.video ? 4 : -1;
    return n;
  };
  const ordenadas = base
    .map((m, i) => ({ m, i, n: nota(m) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(x => x.m);
  if (opts.tipo) return ordenadas.slice(0, MAX_POR_RESPOSTA);
  const escolhidas: MidiaDoBot[] = [];
  const usados = new Set<string>();
  for (const m of ordenadas) {
    const chave = tipoDaLegenda(m) || m.codigo;
    if (!usados.has(chave)) {
      usados.add(chave);
      escolhidas.push(m);
    }
  }
  for (const m of ordenadas) if (!escolhidas.includes(m)) escolhidas.push(m);
  return escolhidas.slice(0, MAX_POR_RESPOSTA);
}

/** Tira do texto as frases que negam ter fotos ou mandam para o Instagram. */
export function semNegativaDeMidia(texto: string): string {
  const nega = /\bn[aã]o\b[^.!?\n]*\b(fotos?|v[ií]deos?|imagens?)\b|\binstagram\b|\binsta\b/i;
  return String(texto || "")
    .split(/\n/)
    .map(linha =>
      linha
        .split(/(?<=[.!?])\s+/)
        .filter(frase => !nega.test(frase))
        .join(" ")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Garante as fotos quando o cliente pediu. Devolve o texto do bot pronto para
 * os canais (com o comando) e os códigos que o SISTEMA escolheu (vazio quando
 * o modelo pediu sozinho ou o cliente não pediu nada).
 */
export function completarPedidoDeMidias(
  texto: string,
  mensagem: string,
  midias: MidiaDoBot[],
  jaEnviadas: Set<string>,
  tipo?: string
): { texto: string; automatico: string[] } {
  const original = String(texto || "");
  if (!midias.length) return { texto: original, automatico: [] };

  if (TEM_PEDIDO.test(original)) {
    // O modelo pediu, mas às vezes sem uma palavra: o cliente recebe só os arquivos.
    const soTexto = original.replace(COMANDO, "").trim();
    return { texto: soTexto ? original : `Claro! ${FRASE_FOTOS}\n${original}`, automatico: [] };
  }

  const pedido = pedidoDoCliente(mensagem);
  if (!pedido.fotos) return { texto: original, automatico: [] };

  const escolhidas = midiasParaOPedido(midias, jaEnviadas, { tipo, video: pedido.video });
  if (!escolhidas.length) return { texto: original, automatico: [] };
  const codigos = escolhidas.map(m => m.codigo);

  const comandos = original.match(COMANDO) || [];
  const limpo = semNegativaDeMidia(original.replace(COMANDO, ""));
  const frase = escolhidas.some(m => m.tipo === "video") ? FRASE_COM_VIDEO : FRASE_FOTOS;
  const corpo = limpo ? `${limpo}\n\n${frase}` : `Claro! ${frase}`;
  return {
    texto: [corpo, ...comandos, `[[ENVIAR_MIDIA codigos="${codigos.join(",")}"]]`].join("\n"),
    automatico: codigos
  };
}

/** As últimas mensagens do cliente neste ticket, para saber o tipo de festa. */
async function ultimasDoCliente(ticketId: number): Promise<string> {
  const msgs = await Message.findAll({
    where: { ticketId, fromMe: false } as any,
    order: [["createdAt", "DESC"]],
    attributes: ["body"],
    limit: 15
  });
  return msgs.map(m => String(m.body || "")).join("\n");
}

/** Usado pelos três canais logo depois do modelo responder. Nunca derruba a resposta. */
export async function garantirMidiasPedidas(
  ticketId: number,
  companyId: number,
  mensagem: string,
  texto: string
): Promise<string> {
  try {
    if (!TEM_PEDIDO.test(texto) && !pedidoDoCliente(mensagem).fotos) return texto;
    const midias = await midiasDaEmpresa(companyId);
    if (!midias.length) return texto;
    const ja = await midiasJaEnviadas(ticketId, midias);
    const tipo = tipoCitado(mensagem) || tipoCitado(await ultimasDoCliente(ticketId));
    const r = completarPedidoDeMidias(texto, mensagem, midias, ja, tipo);
    if (r.automatico.length) {
      logger.warn(`[aiBot] ticket ${ticketId}: cliente pediu fotos e o modelo não mandou; o sistema mandou ${r.automatico.join(",")}`);
    }
    return r.texto;
  } catch (err) {
    logger.warn({ err, ticketId }, "[aiBot] rede de segurança das fotos falhou; segue a resposta do modelo");
    return texto;
  }
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
