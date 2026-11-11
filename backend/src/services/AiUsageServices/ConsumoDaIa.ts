import axios from "axios";
import { QueryTypes } from "sequelize";
import sequelize from "../../database";
import { digitalDaChave } from "../../helpers/usoDaIa";
import { logger } from "../../utils/logger";
import { todasAsChavesEmUso } from "../AiBotServices/AiBotProvidersService";

/**
 * O que a tela "Consumo de IA" do admin da Valora lê (11/11/2026): o consumo
 * gravado em `AiUsageLogs` e a situação de cada chave no provedor. A chave em
 * si nunca sai daqui — só a impressão digital e os 4 últimos caracteres.
 */

export interface LinhaDeConsumo {
  companyId: number;
  empresa: string | null;
  origem: string;
  canal: string | null;
  provider: string;
  model: string;
  chave: string;
  chaveFinal: string | null;
  dona: string;
  chamadas: number;
  falhas: number;
  falhasDeCredito: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number | null;
  ultimaEm: string;
}

export interface DiaDeConsumo {
  dia: string;
  chamadas: number;
  falhas: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number | null;
}

const num = (v: unknown): number => Number(v || 0);
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function resumoDoConsumo(desde: Date, ate: Date): Promise<{ linhas: LinhaDeConsumo[]; dias: DiaDeConsumo[] }> {
  const replacements = { desde, ate };
  const linhas = await sequelize.query<any>(
    `SELECT l."companyId", c.name AS empresa, l.origem, l.canal, l.provider, l.model, l.chave, l."chaveFinal", l.dona,
            COUNT(*) AS chamadas,
            SUM(CASE WHEN l.ok THEN 0 ELSE 1 END) AS falhas,
            SUM(CASE WHEN l.erro IN ('sem_credito', 'cota') THEN 1 ELSE 0 END) AS "falhasDeCredito",
            SUM(l."inputTokens") AS "tokensEntrada",
            SUM(l."outputTokens") AS "tokensSaida",
            SUM(l."costUsd") AS "custoUsd",
            MAX(l."createdAt") AS "ultimaEm"
       FROM "AiUsageLogs" l
       LEFT JOIN "Companies" c ON c.id = l."companyId"
      WHERE l."createdAt" >= :desde AND l."createdAt" < :ate
      GROUP BY l."companyId", c.name, l.origem, l.canal, l.provider, l.model, l.chave, l."chaveFinal", l.dona
      ORDER BY SUM(l."costUsd") DESC NULLS LAST, COUNT(*) DESC`,
    { replacements, type: QueryTypes.SELECT }
  );
  const dias = await sequelize.query<any>(
    `SELECT to_char(l."createdAt" AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS dia,
            COUNT(*) AS chamadas,
            SUM(CASE WHEN l.ok THEN 0 ELSE 1 END) AS falhas,
            SUM(l."inputTokens") AS "tokensEntrada",
            SUM(l."outputTokens") AS "tokensSaida",
            SUM(l."costUsd") AS "custoUsd"
       FROM "AiUsageLogs" l
      WHERE l."createdAt" >= :desde AND l."createdAt" < :ate
      GROUP BY 1
      ORDER BY 1`,
    { replacements, type: QueryTypes.SELECT }
  );
  return {
    linhas: linhas.map(l => ({
      companyId: num(l.companyId),
      empresa: l.empresa ?? null,
      origem: l.origem,
      canal: l.canal ?? null,
      provider: l.provider,
      model: l.model,
      chave: l.chave,
      chaveFinal: l.chaveFinal ?? null,
      dona: l.dona,
      chamadas: num(l.chamadas),
      falhas: num(l.falhas),
      falhasDeCredito: num(l.falhasDeCredito),
      tokensEntrada: num(l.tokensEntrada),
      tokensSaida: num(l.tokensSaida),
      custoUsd: numOuNulo(l.custoUsd),
      ultimaEm: new Date(l.ultimaEm).toISOString()
    })),
    dias: dias.map(d => ({
      dia: d.dia,
      chamadas: num(d.chamadas),
      falhas: num(d.falhas),
      tokensEntrada: num(d.tokensEntrada),
      tokensSaida: num(d.tokensSaida),
      custoUsd: numOuNulo(d.custoUsd)
    }))
  };
}

export interface SaldoNoOpenRouter {
  usoTotal: number | null;
  usoHoje: number | null;
  usoSemana: number | null;
  usoMes: number | null;
  limite: number | null;
  restante: number | null;
  gratuita: boolean | null;
}

export interface SituacaoDaChave {
  chave: string;
  provider: string;
  final: string;
  dona: "valora" | "empresa";
  modelos: string[];
  /** Empresas que gravaram esta chave (as da Valora valem para quem não tem a sua). */
  empresas: Array<{ id: number; nome: string | null }>;
  uso24h: { chamadas: number; falhasDeCredito: number; custoUsd: number | null };
  ultimaFalhaDeCredito: { erro: string; em: string } | null;
  openrouter?: SaldoNoOpenRouter;
  openrouterErro?: string;
}

const OPENROUTER = "https://openrouter.ai/api/v1";

async function saldoDaChaveNoOpenRouter(apiKey: string): Promise<SaldoNoOpenRouter> {
  const { data } = await axios.get(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 10000 });
  const d = data?.data || {};
  return {
    usoTotal: numOuNulo(d.usage),
    usoHoje: numOuNulo(d.usage_daily),
    usoSemana: numOuNulo(d.usage_weekly),
    usoMes: numOuNulo(d.usage_monthly),
    limite: numOuNulo(d.limit),
    restante: numOuNulo(d.limit_remaining),
    gratuita: typeof d.is_free_tier === "boolean" ? d.is_free_tier : null
  };
}

/** Saldo da conta OpenRouter da Valora: só com uma chave de gestão no ambiente. */
export async function saldoDaContaOpenRouter(): Promise<{ creditos: number; usado: number; saldo: number } | null> {
  const chave = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!chave) return null;
  try {
    const { data } = await axios.get(`${OPENROUTER}/credits`, { headers: { Authorization: `Bearer ${chave}` }, timeout: 10000 });
    const creditos = num(data?.data?.total_credits);
    const usado = num(data?.data?.total_usage);
    return { creditos, usado, saldo: Math.round((creditos - usado) * 10000) / 10000 };
  } catch (err: any) {
    logger.warn({ status: err?.response?.status }, "[ia-consumo] saldo da conta OpenRouter não veio");
    return null;
  }
}

export async function situacaoDasChaves(): Promise<SituacaoDaChave[]> {
  const chaves = await todasAsChavesEmUso();
  const empresas = await sequelize.query<{ id: number; name: string }>(`SELECT id, name FROM "Companies"`, { type: QueryTypes.SELECT });
  const nomeDa = new Map(empresas.map(e => [Number(e.id), e.name]));

  const porDigital = new Map<string, SituacaoDaChave & { apiKey: string }>();
  for (const c of chaves) {
    const digital = digitalDaChave(c.apiKey);
    let item = porDigital.get(digital);
    if (!item) {
      item = {
        chave: digital,
        provider: c.provider,
        final: c.final || c.apiKey.slice(-4),
        dona: c.dona === "valora" ? "valora" : "empresa",
        modelos: [],
        empresas: [],
        uso24h: { chamadas: 0, falhasDeCredito: 0, custoUsd: null },
        ultimaFalhaDeCredito: null,
        apiKey: c.apiKey
      };
      porDigital.set(digital, item);
    }
    // A demo copia a chave da Valora para a própria empresa: continua sendo da Valora.
    if (c.dona === "valora") item.dona = "valora";
    if (c.model && !item.modelos.includes(c.model)) item.modelos.push(c.model);
    if (c.companyId && !item.empresas.some(e => e.id === c.companyId)) {
      item.empresas.push({ id: c.companyId, nome: nomeDa.get(c.companyId) ?? null });
    }
  }

  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const uso = await sequelize.query<any>(
    `SELECT chave, COUNT(*) AS chamadas,
            SUM(CASE WHEN erro IN ('sem_credito', 'cota') THEN 1 ELSE 0 END) AS "falhasDeCredito",
            SUM("costUsd") AS "custoUsd"
       FROM "AiUsageLogs" WHERE "createdAt" >= :desde GROUP BY chave`,
    { replacements: { desde }, type: QueryTypes.SELECT }
  );
  const falhas = await sequelize.query<any>(
    `SELECT DISTINCT ON (chave) chave, erro, "createdAt"
       FROM "AiUsageLogs" WHERE erro IN ('sem_credito', 'cota')
      ORDER BY chave, "createdAt" DESC`,
    { type: QueryTypes.SELECT }
  );
  const usoPor = new Map(uso.map(u => [u.chave, u]));
  const falhaPor = new Map(falhas.map(f => [f.chave, f]));

  const saida: SituacaoDaChave[] = [];
  for (const item of porDigital.values()) {
    const u = usoPor.get(item.chave);
    if (u) item.uso24h = { chamadas: num(u.chamadas), falhasDeCredito: num(u.falhasDeCredito), custoUsd: numOuNulo(u.custoUsd) };
    const f = falhaPor.get(item.chave);
    if (f) item.ultimaFalhaDeCredito = { erro: f.erro, em: new Date(f.createdAt).toISOString() };
    if (item.provider === "openrouter") {
      try {
        // eslint-disable-next-line no-await-in-loop
        item.openrouter = await saldoDaChaveNoOpenRouter(item.apiKey);
      } catch (err: any) {
        item.openrouterErro = `O OpenRouter não respondeu (${err?.response?.status || err?.code || "erro"}).`;
      }
    }
    const { apiKey, ...semChave } = item;
    saida.push(semChave);
  }
  return saida.sort((a, b) => (a.dona === b.dona ? a.provider.localeCompare(b.provider) : a.dona === "valora" ? -1 : 1));
}
