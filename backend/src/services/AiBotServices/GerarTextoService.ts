import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import AiUsageLog from "../../models/AiUsageLog";
import { logger } from "../../utils/logger";
import { chamarProvedor } from "../../helpers/aiBot";
import { novoMedidor } from "../../helpers/usoDaIa";
import { registrarUsoDaIa } from "../AiUsageServices/RegistrarUsoDaIa";
import { provedoresDaEmpresa } from "./AiBotProvidersService";

/**
 * Texto livre gerado com os modelos de IA da empresa (ou os da Valora, para quem
 * não tem chave própria). Uso: a Valora monta a configuração do bot a partir do
 * negócio do cliente (Elo genérico, 14/11/2026) — persona, base, funil e campos
 * saem de uma chamada só, com resposta longa.
 *
 * Não é conversa: não passa pela persona nem pelas ferramentas do bot. Quem
 * chama manda o próprio prompt de sistema.
 *
 * Proteções: tamanho do pedido limitado e teto de gerações por empresa em 24 h,
 * porque a chave pode ser a da Valora.
 */
export const ORIGEM_CONFIGURACAO = "configuracao";

const MAX_SISTEMA = 12_000;
const MAX_MENSAGEM = 40_000;
const MAX_TOKENS_DA_RESPOSTA = 4_000;
/**
 * Prazo total, somando os modelos tentados: a tela espera atrás do nginx, que
 * corta em 60 s. Modelo que começaria com menos de 8 s de prazo não é tentado.
 */
const PRAZO_TOTAL_MS = 45_000;
const PRAZO_MINIMO_MS = 8_000;

export function limiteDiario(): number {
  const v = Number(process.env.AI_BOT_GERAR_LIMITE_DIA);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 30;
}

export interface PedidoDeTexto {
  sistema: string;
  mensagem: string;
}

export interface TextoGerado {
  texto: string;
  provider: string;
  model: string;
}

export async function gerarTexto(companyId: number, pedido: PedidoDeTexto): Promise<TextoGerado> {
  const sistema = String(pedido?.sistema || "").trim();
  const mensagem = String(pedido?.mensagem || "").trim();
  if (!sistema || !mensagem) throw new AppError("Envie o prompt de sistema e a mensagem.", 400);
  if (sistema.length > MAX_SISTEMA || mensagem.length > MAX_MENSAGEM) {
    throw new AppError("Pedido grande demais para gerar.", 400);
  }

  const desde = new Date(Date.now() - 24 * 3_600_000);
  const usadas = await AiUsageLog.count({
    where: { companyId, origem: ORIGEM_CONFIGURACAO, createdAt: { [Op.gte]: desde } }
  });
  if (usadas >= limiteDiario()) {
    throw new AppError("Limite de gerações das últimas 24 horas atingido. Tente de novo amanhã.", 429);
  }

  const provedores = (await provedoresDaEmpresa(companyId)).filter(p => p.apiKey);
  if (!provedores.length) throw new AppError("Nenhum modelo de IA configurado nesta conta.", 503);

  const prazo = Date.now() + PRAZO_TOTAL_MS;
  for (const provedor of provedores) {
    const restante = prazo - Date.now();
    if (restante < PRAZO_MINIMO_MS) break;
    const medidor = novoMedidor();
    try {
      // eslint-disable-next-line no-await-in-loop
      const texto = await chamarProvedor(provedor, sistema, [{ role: "user", text: mensagem }], medidor, {
        maxTokens: MAX_TOKENS_DA_RESPOSTA,
        timeoutMs: restante
      });
      void registrarUsoDaIa({ companyId, origem: ORIGEM_CONFIGURACAO }, provedor, medidor.total());
      if (texto.trim()) return { texto: texto.trim(), provider: provedor.provider, model: provedor.model };
      logger.warn({ companyId, provider: provedor.provider, model: provedor.model }, "[gerarTexto] resposta vazia; próximo modelo");
    } catch (err: any) {
      void registrarUsoDaIa({ companyId, origem: ORIGEM_CONFIGURACAO }, provedor, medidor.total(), err);
      logger.warn(
        { companyId, provider: provedor.provider, model: provedor.model, status: err?.response?.status, message: err?.message },
        "[gerarTexto] modelo falhou; próximo"
      );
    }
  }
  throw new AppError("A IA não respondeu agora. Tente de novo em instantes.", 502);
}
