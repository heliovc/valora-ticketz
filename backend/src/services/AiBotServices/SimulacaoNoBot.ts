import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import { logger } from "../../utils/logger";
import { legendaDaSimulacao, simular, ResultadoDaSimulacao } from "./SimuladorTaxas";
import { imagemDaSimulacao } from "./SimuladorImagem";

/**
 * O bot pede a simulação com um marcador no meio da resposta:
 *
 *   [[SIMULAR faturamento=100000 taxa=0,99 tipo=comercio]]
 *
 * O CRM tira o marcador do texto, faz a conta (a mesma do simulador da
 * página), gera a imagem e envia pelo canal do card. O bot nunca escreve
 * número de economia: a legenda sai da conta, não do modelo de linguagem.
 */

const MARCADOR = /\[\[\s*SIMULAR([^\]]*)\]\]/i;

export interface PedidoDeSimulacao {
  fat: number;
  taxa1: number;
  anexo: string;
}

/** Número em português: "100.000,00", "100000", "0,99", "3.5". */
function numeroBR(bruto: string | undefined): number {
  if (!bruto) return NaN;
  let s = bruto.replace(/[^\d.,-]/g, "");
  // "100.000" é cem mil, não cem: ponto seguido de grupos de 3 é milhar.
  if (!s.includes(",") && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  return parseFloat(s);
}

function anexoDoTipo(tipo: string | undefined): string {
  const t = (tipo || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (t.startsWith("ind")) return "2";
  if (t.startsWith("serv")) return "3";
  return "1";
}

export function extrairPedidoDeSimulacao(texto: string): {
  /** Texto inteiro sem o marcador (para canais que não mandam imagem). */
  texto: string;
  /** O que vem antes do marcador — sai antes da imagem. */
  antes: string;
  /** O que vem depois — sai depois da imagem (ex.: a próxima pergunta). */
  depois: string;
  pedido: PedidoDeSimulacao | null;
} {
  const achado = MARCADOR.exec(texto || "");
  if (!achado) return { texto, antes: texto, depois: "", pedido: null };
  const antes = texto.slice(0, achado.index).trim();
  const depois = texto.slice(achado.index + achado[0].length).trim();
  const limpo = [antes, depois].filter(Boolean).join("\n\n");
  const campos: Record<string, string> = {};
  // "R$ 85.500,50" e "2,5 %" também valem: o modelo às vezes formata.
  const bruto = achado[1].replace(/R\$\s*/gi, "").replace(/\s+%/g, "%");
  for (const par of bruto.matchAll(/(\w+)\s*=\s*("[^"]*"|\S+)/g)) {
    campos[par[1].toLowerCase()] = par[2].replace(/"/g, "");
  }
  const fat = numeroBR(campos.faturamento ?? campos.fat);
  const taxa1 = numeroBR(campos.taxa ?? campos.taxa1);
  // Dado faltando ou absurdo: o pedido é ignorado e só o texto sai — melhor
  // que mandar uma simulação errada para o cliente.
  if (!(fat > 0) || !(taxa1 >= 0) || taxa1 > 30) {
    logger.warn({ campos }, "[simulador] pedido do bot incompleto, ignorado");
    return { texto: limpo, antes: limpo, depois: "", pedido: null };
  }
  return { texto: limpo, antes, depois, pedido: { fat, taxa1, anexo: anexoDoTipo(campos.tipo) } };
}

export interface SimulacaoPronta {
  resultado: ResultadoDaSimulacao;
  imagem: Buffer;
  legenda: string;
  /** Caminho relativo em `public/`, para a conversa no CRM mostrar a imagem. */
  arquivo: string;
}

/**
 * Faz a conta e gera a imagem. `null` quando o caso é do consultor (acima do
 * Simples) — quem chama manda só o texto e o aviso.
 */
export async function prepararSimulacao(
  companyId: number,
  ticketId: number,
  pedido: PedidoDeSimulacao
): Promise<SimulacaoPronta | null> {
  // Taxa proposta: a da empresa (padrão 6% — crédito à vista Valora). Nunca do bot.
  const taxa2 = numeroBR(await GetCompanySetting(companyId, "simuladorTaxaProposta", "6")) || 6;
  const resultado = simular({ ...pedido, taxa2 });
  if (resultado.a1.acima) return null;

  const imagem = await imagemDaSimulacao(resultado);
  const pasta = path.resolve("public", "simulacoes");
  fs.mkdirSync(pasta, { recursive: true });
  const nome = `simulacao-${companyId}-${ticketId}-${randomUUID().slice(0, 8)}.jpg`;
  fs.writeFileSync(path.join(pasta, nome), new Uint8Array(imagem));
  return { resultado, imagem, legenda: legendaDaSimulacao(resultado), arquivo: `simulacoes/${nome}` };
}

export const AVISO_ACIMA_DO_SIMPLES =
  "Pelo seu faturamento, a empresa passa do limite do Simples Nacional — aí a conta é diferente. Vou pedir para o consultor montar a simulação do seu caso.";

export type { Ticket, Contact };
