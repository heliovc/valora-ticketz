import axios from "axios";
import AppError from "../../errors/AppError";
import Setting from "../../models/Setting";
import { decryptCloudApiToken, encryptCloudApiToken } from "../../helpers/cloudApiCrypto";
import { logger } from "../../utils/logger";
import {
  MODELO_PADRAO,
  NomeDoProvedor,
  ProvedorDoBot,
  chamarProvedor
} from "../../helpers/aiBot";

/**
 * Modelos de IA do bot, POR EMPRESA (CRM → Bot → Modelos de IA).
 *
 * Cada empresa usa só as próprias chaves: a da Valora nunca atende outra
 * conta, e vice-versa. As chaves ficam cifradas no banco (mesma chave de
 * cifra do WhatsApp Oficial) e nunca voltam para a tela — só os 4 últimos
 * caracteres, para a pessoa saber qual está salva.
 */

const CHAVE = "aiBotProviders";
const NOMES: NomeDoProvedor[] = ["gemini", "groq", "anthropic"];
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

/** Para o motor do bot: a lista na ordem, com as chaves decifradas. */
export async function provedoresDaEmpresa(companyId: number): Promise<ProvedorDoBot[]> {
  const gravados = await lerGravados(companyId);
  const prontos: ProvedorDoBot[] = [];
  for (const g of gravados) {
    try {
      prontos.push({ provider: g.provider, model: g.model, apiKey: decryptCloudApiToken(g.keyEnc) });
    } catch (err: any) {
      logger.error({ companyId, provider: g.provider, message: err?.message }, "[aiBot] chave do modelo ilegível");
    }
  }
  return prontos;
}

/** Para a tela: sem a chave, só o final dela. */
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
    const resposta = await chamarProvedor(provedor, "Responda apenas: ok", [{ role: "user", text: "teste" }]);
    return { ok: true, resposta: resposta.slice(0, 60) };
  } catch (err: any) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const corpo = axios.isAxiosError(err) ? JSON.stringify(err.response?.data || "") : "";
    let erro = `Falhou${status ? ` (${status})` : ""}.`;
    if (status === 401 || status === 403 || /API key|invalid_api_key|PERMISSION/i.test(corpo)) erro = "Chave recusada pelo provedor.";
    else if (status === 429) erro = /PerDay/i.test(corpo) ? "Cota do dia esgotada neste modelo." : "Limite de uso atingido agora; tente em instantes.";
    else if (status === 404) erro = "Modelo não encontrado neste provedor.";
    return { ok: false, erro };
  }
}
