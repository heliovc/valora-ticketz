import Queue from "bull";
import { Op, fn, col } from "sequelize";
import AppError from "../../errors/AppError";
import CloudApiBroadcast from "../../models/CloudApiBroadcast";
import CloudApiBroadcastRecipient from "../../models/CloudApiBroadcastRecipient";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import { brNumberVariants } from "./CloudApiChannel";
import { sendTemplate } from "./CloudApiSendService";
import {
  conexaoOficialDaEmpresa,
  limparParametro,
  modeloAprovado,
  textoDoModelo
} from "./CloudApiTemplateService";

/**
 * Disparo em massa pelo WhatsApp Oficial.
 *
 * Só por modelo aprovado e só pela conexão oficial escolhida — nunca cai em
 * outra conexão. Disparo em massa pelo WhatsApp por QR Code foi deixado de
 * fora de propósito: é o que faz a Meta banir o número.
 *
 * Tudo preso à empresa de quem pede: conexão, disparo e destinatários.
 */

/** Teto por disparo. Acima disso o limite diário da Meta corta antes. */
const MAX_DESTINATARIOS = 10000;
/** Intervalo entre envios. A Meta aceita bem mais; aqui é folga para o número. */
const INTERVALO_MS = Number(process.env.CLOUDAPI_BROADCAST_INTERVAL_MS || 300);
/** Espera quando a Meta diz "limite atingido". */
const ESPERA_LIMITE_MS = 60 * 1000;

const connection = process.env.REDIS_URI || "";
export const cloudApiBroadcastQueue = new Queue("CloudApiBroadcastQueue", connection);

const espera = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface Destinatario {
  number: string;
  name: string | null;
}

/**
 * Lê a lista colada: um contato por linha, "número" ou "número;nome" (vírgula
 * ou tab também servem, e o nome pode vir antes). Número brasileiro sem 55
 * ganha o 55. Repetidos saem — o mesmo número em duas variantes (com e sem o
 * nono dígito) conta como um.
 */
export function lerDestinatarios(texto: string): {
  validos: Destinatario[];
  invalidos: string[];
} {
  const validos: Destinatario[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();

  for (const linhaBruta of String(texto || "").split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha) continue;
    const partes = linha.split(/[;,\t]/).map(p => p.trim()).filter(Boolean);
    const indiceNumero = partes.findIndex(p => p.replace(/\D/g, "").length >= 8);
    if (indiceNumero < 0) {
      invalidos.push(linha);
      continue;
    }
    const bruto = partes[indiceNumero];
    let numero = bruto.replace(/\D/g, "");
    // Com "+" o DDI já veio; sem ele, 10 ou 11 dígitos é DDD + número do Brasil.
    if (!bruto.startsWith("+") && (numero.length === 10 || numero.length === 11)) {
      numero = `55${numero}`;
    }
    if (numero.length < 10 || numero.length > 15) {
      invalidos.push(linha);
      continue;
    }
    const variantes = brNumberVariants(numero);
    if (variantes.some(v => vistos.has(v)) || vistos.has(numero)) continue;
    variantes.forEach(v => vistos.add(v));
    vistos.add(numero);
    const nome = partes.filter((_p, i) => i !== indiceNumero).join(" ").trim();
    validos.push({ number: numero, name: nome || null });
  }
  return { validos, invalidos };
}

/** Parâmetros do destinatário: `{{nome}}` vira o nome (ou "cliente"). */
function parametrosPara(params: string[], destinatario: Destinatario): string[] {
  const primeiroNome = (destinatario.name || "").split(/\s+/)[0] || "cliente";
  return params.map(p =>
    limparParametro(
      String(p ?? "")
        .replace(/\{\{\s*nome\s*\}\}/gi, primeiroNome)
        .replace(/\{\{\s*nome_completo\s*\}\}/gi, destinatario.name || "cliente")
    )
  );
}

export interface NovoDisparo {
  whatsappId: number;
  name: string;
  templateName: string;
  language: string;
  params?: string[];
  contatos: string;
}

export async function criarDisparo(
  companyId: number,
  userId: number | null,
  dados: NovoDisparo
): Promise<CloudApiBroadcast> {
  const name = String(dados.name || "").trim();
  if (!name) throw new AppError("Dê um nome ao disparo.", 400);

  const conexao = await conexaoOficialDaEmpresa(companyId, dados.whatsappId);
  const modelo = await modeloAprovado(
    companyId,
    conexao.id,
    dados.templateName,
    dados.language
  );

  const params = (dados.params || []).map(p => String(p ?? ""));
  if (params.slice(0, modelo.variaveis).filter(p => p.trim()).length < modelo.variaveis) {
    throw new AppError(
      `O modelo pede ${modelo.variaveis} variável(is). Preencha todas (pode usar {{nome}}).`,
      400
    );
  }

  const { validos } = lerDestinatarios(dados.contatos);
  if (!validos.length) {
    throw new AppError("Nenhum número válido na lista.", 400);
  }
  if (validos.length > MAX_DESTINATARIOS) {
    throw new AppError(
      `No máximo ${MAX_DESTINATARIOS} números por disparo (a lista tem ${validos.length}).`,
      400
    );
  }

  const disparo = await CloudApiBroadcast.create({
    companyId,
    whatsappId: conexao.id,
    userId,
    name,
    templateName: modelo.name,
    templateLanguage: modelo.language,
    params: params.slice(0, modelo.variaveis),
    status: "EM_ANDAMENTO",
    total: validos.length
  } as any);

  const lote = 500;
  for (let i = 0; i < validos.length; i += lote) {
    // eslint-disable-next-line no-await-in-loop
    await CloudApiBroadcastRecipient.bulkCreate(
      validos.slice(i, i + lote).map(d => ({
        broadcastId: disparo.id,
        companyId,
        number: d.number,
        name: d.name,
        status: "PENDENTE"
      })) as any
    );
  }

  await enfileirar(disparo.id);
  return disparo;
}

async function enfileirar(broadcastId: number): Promise<void> {
  // jobId fixo: retomar depois de reiniciar não duplica o processamento.
  await cloudApiBroadcastQueue.add(
    "Processar",
    { broadcastId },
    { jobId: `disparo-${broadcastId}`, removeOnComplete: true, removeOnFail: true }
  );
}

/** Contagem por situação de vários disparos, numa consulta. */
async function contagens(
  ids: number[]
): Promise<Map<number, Record<string, number>>> {
  const mapa = new Map<number, Record<string, number>>();
  if (!ids.length) return mapa;
  const linhas: any[] = await CloudApiBroadcastRecipient.findAll({
    where: { broadcastId: { [Op.in]: ids } },
    attributes: ["broadcastId", "status", [fn("COUNT", col("id")), "n"]],
    group: ["broadcastId", "status"],
    raw: true
  });
  for (const l of linhas) {
    const atual = mapa.get(l.broadcastId) || {};
    atual[l.status] = Number(l.n);
    mapa.set(l.broadcastId, atual);
  }
  return mapa;
}

export async function listarDisparos(companyId: number) {
  const disparos = await CloudApiBroadcast.findAll({
    where: { companyId },
    include: [{ model: Whatsapp, attributes: ["id", "name", "cloudApiDisplayNumber"] }],
    order: [["id", "DESC"]],
    limit: 100
  });
  const porId = await contagens(disparos.map(d => d.id));
  return disparos.map(d => ({ ...d.toJSON(), contagem: porId.get(d.id) || {} }));
}

export async function detalharDisparo(companyId: number, id: number) {
  const disparo = await CloudApiBroadcast.findOne({
    where: { id, companyId },
    include: [{ model: Whatsapp, attributes: ["id", "name", "cloudApiDisplayNumber"] }]
  });
  if (!disparo) throw new AppError("Disparo não encontrado.", 404);
  const destinatarios = await CloudApiBroadcastRecipient.findAll({
    where: { broadcastId: id, companyId },
    attributes: ["id", "number", "name", "status", "error", "sentAt"],
    order: [["id", "ASC"]],
    limit: 2000
  });
  const porId = await contagens([id]);
  return { ...disparo.toJSON(), contagem: porId.get(id) || {}, destinatarios };
}

export async function cancelarDisparo(companyId: number, id: number): Promise<void> {
  const disparo = await CloudApiBroadcast.findOne({ where: { id, companyId } });
  if (!disparo) throw new AppError("Disparo não encontrado.", 404);
  if (disparo.status !== "EM_ANDAMENTO") return;
  await disparo.update({ status: "CANCELADO" });
}

/** Processa um disparo até o fim, um destinatário por vez. */
async function processar(broadcastId: number): Promise<void> {
  const disparo = await CloudApiBroadcast.findByPk(broadcastId);
  if (!disparo || disparo.status !== "EM_ANDAMENTO") return;

  // A conexão é relida da empresa do disparo, nunca de fora.
  const conexao = await Whatsapp.findOne({
    where: { id: disparo.whatsappId, companyId: disparo.companyId }
  });
  if (!conexao) {
    await disparo.update({ status: "CANCELADO" });
    return;
  }

  let modelo;
  try {
    modelo = await modeloAprovado(
      disparo.companyId,
      conexao.id,
      disparo.templateName,
      disparo.templateLanguage
    );
  } catch (err: any) {
    logger.warn(`[disparo ${broadcastId}] modelo indisponível: ${err?.message}`);
    await CloudApiBroadcastRecipient.update(
      { status: "FALHOU", error: `Modelo indisponível: ${err?.message}` } as any,
      { where: { broadcastId, status: "PENDENTE" } }
    );
    await disparo.update({ status: "CONCLUIDO" });
    return;
  }

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    await disparo.reload();
    if (disparo.status !== "EM_ANDAMENTO") return;

    // eslint-disable-next-line no-await-in-loop
    const proximo = await CloudApiBroadcastRecipient.findOne({
      where: { broadcastId, status: "PENDENTE" },
      order: [["id", "ASC"]]
    });
    if (!proximo) break;

    const params = parametrosPara(disparo.params || [], proximo);
    let tentativas = 0;
    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { wamid } = await sendTemplate(
          conexao,
          proximo.number,
          modelo.name,
          modelo.language,
          params
        );
        // eslint-disable-next-line no-await-in-loop
        await proximo.update({
          status: "ENVIADO",
          wamid,
          sentAt: new Date(),
          text: textoDoModelo(modelo, params),
          error: null
        } as any);
        break;
      } catch (err: any) {
        const mensagem = String(err?.message || "falha");
        tentativas += 1;
        if (/Limite de envio/i.test(mensagem) && tentativas <= 5) {
          logger.warn(`[disparo ${broadcastId}] limite da Meta, aguardando`);
          // eslint-disable-next-line no-await-in-loop
          await espera(ESPERA_LIMITE_MS);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        await proximo.update({ status: "FALHOU", error: mensagem } as any);
        break;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await espera(INTERVALO_MS);
  }

  await disparo.update({ status: "CONCLUIDO" });
  logger.info(`[disparo ${broadcastId}] concluído`);
}

/**
 * Status de entrega vindo do webhook. Só sobe (enviado → entregue → lido);
 * falha marca o erro. Preso à empresa da conexão que recebeu o evento.
 */
export async function atualizarPorStatus(
  companyId: number,
  wamid: string,
  status: string,
  erro?: string
): Promise<void> {
  if (!wamid) return;
  const destinatario = await CloudApiBroadcastRecipient.findOne({
    where: { wamid, companyId }
  });
  if (!destinatario) return;
  const ordem = ["ENVIADO", "ENTREGUE", "LIDO"];
  if (status === "failed") {
    await destinatario.update({ status: "FALHOU", error: erro || "A Meta não entregou" } as any);
    return;
  }
  const novo = status === "read" ? "LIDO" : status === "delivered" ? "ENTREGUE" : null;
  if (!novo) return;
  if (ordem.indexOf(novo) > ordem.indexOf(destinatario.status)) {
    await destinatario.update({ status: novo } as any);
  }
}

/**
 * O último disparo que este número recebeu por esta conexão nos últimos 7
 * dias — para o card mostrar a que o cliente está respondendo.
 */
export async function ultimoDisparoRecebido(
  companyId: number,
  whatsappId: number,
  numero: string
): Promise<CloudApiBroadcastRecipient | null> {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return CloudApiBroadcastRecipient.findOne({
    where: {
      companyId,
      number: { [Op.in]: brNumberVariants(numero) },
      status: { [Op.in]: ["ENVIADO", "ENTREGUE", "LIDO"] },
      sentAt: { [Op.gte]: desde }
    },
    include: [
      {
        model: CloudApiBroadcast,
        where: { whatsappId, companyId },
        attributes: ["id", "name"]
      }
    ],
    order: [["sentAt", "DESC"]]
  });
}

export function startCloudApiBroadcastQueue(): void {
  cloudApiBroadcastQueue.process("Processar", 1, async (job: any) => {
    await processar(Number(job.data.broadcastId));
  });
  // Retoma o que estava no meio quando o servidor caiu ou foi reiniciado.
  CloudApiBroadcast.findAll({ where: { status: "EM_ANDAMENTO" }, attributes: ["id"] })
    .then(pendentes => Promise.all(pendentes.map(d => enfileirar(d.id))))
    .catch(err => logger.error(`[disparo] falha ao retomar: ${err?.message}`));
}
