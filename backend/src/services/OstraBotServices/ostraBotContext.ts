import { createSign } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { Op } from "sequelize";
import OstraBotMessage from "../../models/OstraBotMessage";
import { logger } from "../../utils/logger";
import { FUSO, MAX_LINHAS } from "./ostraBotRules";

/**
 * Contexto e geração da resposta do assistente Ostra Carioca.
 *
 * Toda fonte de contexto é opcional: se a página ou a planilha falharem, o
 * rascunho sai com o que houver e o modelo é instruído a dizer que vai checar
 * em vez de inventar. A aprovação do Hélio é a última barreira.
 */

const PAGINA_PROJETO = "https://valorasolucoes.com/brisa-ostra/";
const CACHE_PAGINA_MS = 24 * 60 * 60 * 1000;
const CACHE_PLANILHA_MS = 5 * 60 * 1000;
const MAX_CHARS_PAGINA = 8000;
const MAX_CHARS_PLANILHA = 15000;
const HISTORICO = 50;

const modelo = () => process.env.OSTRA_BOT_MODEL || "claude-sonnet-5-5";

let cachePagina: { texto: string; em: number } | null = null;
let cachePlanilha: { texto: string; em: number } | null = null;

/** Texto corrido da página do projeto, sem HTML. Cache de 24h. */
export const resumoDaPagina = async (): Promise<string> => {
  if (cachePagina && Date.now() - cachePagina.em < CACHE_PAGINA_MS) {
    return cachePagina.texto;
  }
  try {
    const { data } = await axios.get<string>(PAGINA_PROJETO, {
      timeout: 10000,
      responseType: "text"
    });
    const texto = String(data)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CHARS_PAGINA);
    cachePagina = { texto, em: Date.now() };
    return texto;
  } catch (err) {
    logger.warn(
      { err: err?.message },
      "[ostraBot] página do projeto indisponível"
    );
    return cachePagina?.texto || "";
  }
};

type ContaDeServico = { client_email: string; private_key: string };

const lerContaDeServico = (): ContaDeServico | null => {
  const b64 = process.env.OSTRA_GOOGLE_CREDENTIALS_B64;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    if (!json.client_email || !json.private_key) return null;
    return json;
  } catch {
    logger.warn("[ostraBot] OSTRA_GOOGLE_CREDENTIALS_B64 inválida");
    return null;
  }
};

/** Token OAuth da Service Account, assinado aqui (sem SDK do Google). */
const tokenDoGoogle = async (conta: ContaDeServico): Promise<string> => {
  const agora = Math.floor(Date.now() / 1000);
  const b64url = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const corpo = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: conta.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: agora,
    exp: agora + 3600
  })}`;
  const assinatura = createSign("RSA-SHA256")
    .update(corpo)
    .sign(conta.private_key, "base64url");
  const { data } = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${corpo}.${assinatura}`
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 10000
    }
  );
  return data.access_token;
};

/** Aba ORÇAMENTOS em texto tabulado. Cache de 5 min. */
export const conteudoDaPlanilha = async (): Promise<string> => {
  if (cachePlanilha && Date.now() - cachePlanilha.em < CACHE_PLANILHA_MS) {
    return cachePlanilha.texto;
  }
  const conta = lerContaDeServico();
  const planilha = process.env.OSTRA_SHEET_ID;
  const aba = process.env.OSTRA_SHEET_TAB || "ORÇAMENTOS";
  if (!conta || !planilha) return "";
  try {
    const token = await tokenDoGoogle(conta);
    const { data } = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${planilha}/values/${encodeURIComponent(aba)}`,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );
    const linhas: string[][] = data.values || [];
    const texto = linhas
      .map(l => l.join("\t").trim())
      .filter(Boolean)
      .join("\n")
      .slice(0, MAX_CHARS_PLANILHA);
    cachePlanilha = { texto, em: Date.now() };
    return texto;
  } catch (err) {
    // Só a mensagem: o corpo do erro do Google pode ecoar a requisição.
    logger.warn(
      { err: err?.message, status: err?.response?.status },
      "[ostraBot] planilha indisponível"
    );
    return cachePlanilha?.texto || "";
  }
};

const horaCurta = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);

/** Últimas 50 mensagens do grupo, da mais antiga para a mais recente. */
export const historicoDoGrupo = async (
  groupJid: string,
  ate: Date
): Promise<string> => {
  const msgs = await OstraBotMessage.findAll({
    where: { groupJid, enviadaEm: { [Op.lte]: ate } },
    order: [["enviadaEm", "DESC"]],
    limit: HISTORICO
  });
  return msgs
    .reverse()
    .map(m => `[${horaCurta(m.enviadaEm)}] ${m.autor}: ${m.texto}`)
    .join("\n");
};

const SYSTEM = `Você é o assistente do projeto Ostra Carioca, um food truck/carrinho de ostras no Rio de Janeiro. Os sócios são Dani, Germano, Renata e Hélio. Você responde no grupo de WhatsApp deles quando alguém começa a mensagem com "Claude".

Regras:
- Responda em português, direto, em no máximo ${MAX_LINHAS} linhas curtas. Sem títulos, sem listas longas, sem markdown.
- Não invente preços, fornecedores, prazos nem números. Use só o que está na planilha, na página do projeto ou na conversa. Se não souber, diga que vai checar.
- Contas simples (quantidade × preço, margem, divisão entre sócios) você pode fazer, mostrando o resultado.
- Nunca prometa nada em nome do Hélio nem de outro sócio, e não fale como se fosse ele.
- Não comece com "🤖": o prefixo é colocado automaticamente.`;

export const gerarResposta = async (p: {
  groupJid: string;
  autor: string;
  pergunta: string;
  pedidoEm: Date;
}): Promise<string> => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY ausente");

  const [pagina, planilha, historico] = await Promise.all([
    resumoDaPagina(),
    conteudoDaPlanilha(),
    historicoDoGrupo(p.groupJid, p.pedidoEm)
  ]);

  const contexto = [
    `## Página do projeto (${PAGINA_PROJETO})\n${pagina || "(indisponível agora)"}`,
    `## Planilha, aba ORÇAMENTOS\n${planilha || "(indisponível agora: não cite valores da planilha)"}`,
    `## Últimas mensagens do grupo\n${historico || "(sem histórico ainda)"}`
  ].join("\n\n");

  const client = new Anthropic({ apiKey });
  const resposta = await client.messages.create({
    model: modelo(),
    max_tokens: 400,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `${contexto}\n\n## Pedido\n${p.autor} perguntou no grupo: "${p.pergunta}"\n\nEscreva a resposta que vai para o grupo.`
      }
    ]
  });

  const texto = resposta.content
    .map(b => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!texto) throw new Error("modelo devolveu resposta vazia");
  return texto;
};
