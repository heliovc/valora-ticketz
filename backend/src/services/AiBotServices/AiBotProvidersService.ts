import axios from "axios";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import { decryptCloudApiToken, encryptCloudApiToken } from "../../helpers/cloudApiCrypto";
import { logger } from "../../utils/logger";
import { novoMedidor } from "../../helpers/usoDaIa";
import { registrarUsoDaIa } from "../AiUsageServices/RegistrarUsoDaIa";
import {
  MODELO_PADRAO,
  NomeDoProvedor,
  ProvedorDoBot,
  chamarProvedor
} from "../../helpers/aiBot";

/**
 * Modelos de IA do bot, POR EMPRESA (CRM → Bot → Modelos de IA).
 *
 * Cada empresa usa as próprias chaves, cifradas no banco (mesma chave de cifra
 * do WhatsApp Oficial) e nunca devolvidas à tela — só os 4 últimos caracteres.
 *
 * Empresa SEM modelo próprio usa os da Valora, lidos do ambiente (decisão do
 * Hélio, 26/10/2026, para o Elo Eventos: "chave de IA da Valora"). Antes, sem
 * chave própria o bot simplesmente não respondia. A chave da Valora nunca
 * aparece na tela de ninguém.
 */
const CHAVE = "aiBotProviders";
const NOMES: NomeDoProvedor[] = ["gemini", "groq", "anthropic", "openrouter"];
const MAX = 4;

type Gravado = { provider: NomeDoProvedor; model: string; keyEnc: string; final: string };

async function lerGravados(companyId: number): Promise<Gravado[]> {
  const setting = await Setting.findOne({ where: { companyId, key: CHAVE } });
  if (!setting?.value) return [];
  try {
    const lista = JSON.parse(setting.value);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * Modelos da Valora, do ambiente: `AI_BOT_VALORA_PROVIDERS` (JSON
 * `[{"provider":"anthropic","model":"claude-haiku-4-5","apiKey":"..."}]`) ou,
 * na falta dele, as chaves soltas `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` /
 * `GROQ_API_KEY`, nessa ordem de preferência.
 */
export function provedoresDaValora(): ProvedorDoBot[] {
  const lista: ProvedorDoBot[] = [];
  const json = process.env.AI_BOT_VALORA_PROVIDERS;
  if (json) {
    try {
      const itens = JSON.parse(json);
      if (Array.isArray(itens)) {
        for (const it of itens) {
          const provider = String(it?.provider || "").toLowerCase() as NomeDoProvedor;
          if (NOMES.includes(provider) && it?.apiKey) {
            lista.push({ provider, model: String(it.model || MODELO_PADRAO[provider]), apiKey: String(it.apiKey), dona: "valora", final: String(it.apiKey).slice(-4) });
          }
        }
      }
    } catch (err: any) {
      logger.error({ message: err?.message }, "[aiBot] AI_BOT_VALORA_PROVIDERS inválido");
    }
  }
  if (lista.length) return lista;
  const daValora = (p: ProvedorDoBot): ProvedorDoBot => ({ ...p, dona: "valora", final: p.apiKey.slice(-4) });
  if (process.env.ANTHROPIC_API_KEY) lista.push(daValora({ provider: "anthropic", model: process.env.AI_BOT_MODEL || MODELO_PADRAO.anthropic, apiKey: process.env.ANTHROPIC_API_KEY }));
  if (process.env.GEMINI_API_KEY) lista.push(daValora({ provider: "gemini", model: process.env.AI_BOT_GEMINI_MODEL || MODELO_PADRAO.gemini, apiKey: process.env.GEMINI_API_KEY }));
  if (process.env.GROQ_API_KEY) lista.push(daValora({ provider: "groq", model: MODELO_PADRAO.groq, apiKey: process.env.GROQ_API_KEY }));
  return lista;
}

/** Para o motor do bot: os da empresa, na ordem, com as chaves decifradas — ou os da Valora. */
export async function provedoresDaEmpresa(companyId: number): Promise<ProvedorDoBot[]> {
  const gravados = await lerGravados(companyId);
  const prontos: ProvedorDoBot[] = [];
  for (const g of gravados) {
    try {
      prontos.push({ provider: g.provider, model: g.model, apiKey: decryptCloudApiToken(g.keyEnc), dona: "empresa", final: g.final });
    } catch (err: any) {
      logger.error({ companyId, provider: g.provider, message: err?.message }, "[aiBot] chave do modelo ilegível");
    }
  }
  return prontos.length ? prontos : provedoresDaValora();
}

/**
 * Todas as chaves em uso (as da Valora e as de cada empresa), decifradas, para
 * a tela de consumo consultar o saldo no provedor. Uso interno: a chave nunca
 * sai do motor.
 */
export async function todasAsChavesEmUso(): Promise<Array<ProvedorDoBot & { companyId: number | null }>> {
  const lista: Array<ProvedorDoBot & { companyId: number | null }> = provedoresDaValora().map(p => ({ ...p, companyId: null }));
  const settings = await Setting.findAll({ where: { key: CHAVE } });
  for (const st of settings) {
    // eslint-disable-next-line no-await-in-loop
    for (const p of await provedoresDaEmpresaSemReserva(st.companyId)) lista.push({ ...p, companyId: st.companyId });
  }
  return lista;
}

/** Só as chaves gravadas pela empresa, sem cair nas da Valora. */
async function provedoresDaEmpresaSemReserva(companyId: number): Promise<ProvedorDoBot[]> {
  const prontos: ProvedorDoBot[] = [];
  for (const g of await lerGravados(companyId)) {
    try {
      prontos.push({ provider: g.provider, model: g.model, apiKey: decryptCloudApiToken(g.keyEnc), dona: "empresa", final: g.final });
    } catch {
      // Chave ilegível já é avisada em `provedoresDaEmpresa`.
    }
  }
  return prontos;
}

/** Para a tela: sem a chave, só o final dela. Os da Valora não aparecem. */
export async function descreverProvedores(companyId: number) {
  return (await lerGravados(companyId)).map(g => ({
    provider: g.provider,
    model: g.model,
    temChave: !!g.keyEnc,
    final: g.final
  }));
}

export interface ProvedorRecebido {
  provider: string;
  model?: string;
  /** Vazio = manter a chave já salva nesta posição para este provedor. */
  apiKey?: string;
}

export async function salvarProvedores(
  companyId: number,
  recebidos: ProvedorRecebido[]
): Promise<void> {
  if (!Array.isArray(recebidos)) throw new AppError("Lista de modelos inválida.", 400);
  if (recebidos.length > MAX) throw new AppError(`No máximo ${MAX} modelos.`, 400);
  const atuais = await lerGravados(companyId);
  const novos: Gravado[] = [];
  recebidos.forEach((r, i) => {
    const provider = String(r.provider || "").toLowerCase() as NomeDoProvedor;
    if (!NOMES.includes(provider)) throw new AppError(`Provedor desconhecido: ${r.provider}`, 400);
    const model = String(r.model || "").trim() || MODELO_PADRAO[provider];
    if (!/^[\w.:/-]{2,80}$/.test(model)) throw new AppError(`Nome de modelo inválido: ${model}`, 400);
    const chaveNova = String(r.apiKey || "").trim();
    // Sem chave nova: reaproveita a já salva do MESMO provedor (na mesma
    // posição, ou a primeira desse provedor) — a tela nunca recebe a chave.
    const anterior =
      (atuais[i]?.provider === provider ? atuais[i] : undefined) ||
      atuais.find(a => a.provider === provider);
    if (!chaveNova && !anterior) {
      throw new AppError(`Informe a chave do ${provider} (posição ${i + 1}).`, 400);
    }
    novos.push({
      provider,
      model,
      keyEnc: chaveNova ? encryptCloudApiToken(chaveNova) : anterior!.keyEnc,
      final: chaveNova ? chaveNova.slice(-4) : anterior!.final
    });
  });
  const [setting] = await Setting.findOrCreate({
    where: { companyId, key: CHAVE },
    defaults: { companyId, key: CHAVE, value: "[]" } as any
  });
  await setting.update({ value: JSON.stringify(novos) });
}

/** Testa um modelo salvo (posição) pedindo uma resposta mínima. */
export async function testarProvedor(
  companyId: number,
  posicao: number
): Promise<{ ok: boolean; resposta?: string; erro?: string }> {
  const provedores = await provedoresDaEmpresa(companyId);
  const provedor = provedores[posicao];
  if (!provedor) throw new AppError("Modelo não encontrado. Salve antes de testar.", 404);
  try {
    const medidor = novoMedidor();
    try {
      const resposta = await chamarProvedor(provedor, "Responda apenas: ok", [{ role: "user", text: "teste" }], medidor);
      void registrarUsoDaIa({ companyId, origem: "teste" }, provedor, medidor.total());
      return { ok: true, resposta: resposta.slice(0, 60) };
    } catch (err) {
      void registrarUsoDaIa({ companyId, origem: "teste" }, provedor, medidor.total(), err);
      throw err;
    }
  } catch (err: any) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const corpo = axios.isAxiosError(err) ? JSON.stringify(err.response?.data || "") : "";
    let erro = `Falhou${status ? ` (${status})` : ""}.`;
    if (status === 401 || status === 403 || /API key|invalid_api_key|PERMISSION/i.test(corpo)) erro = "Chave recusada pelo provedor.";
    else if (status === 429) erro = /PerDay/i.test(corpo) ? "Cota do dia esgotada neste modelo." : "Limite de uso atingido agora; tente em instantes.";
    else if (status === 404) erro = "Modelo não encontrado neste provedor.";
    // O motivo dado pelo provedor (nunca a chave): sem ele, "Falhou (400)" não diz nada.
    const motivo = /"message"\s*:\s*"([^"]{1,200})"/.exec(corpo)?.[1];
    return { ok: false, erro: motivo ? `${erro} ${motivo}` : erro };
  }
}
