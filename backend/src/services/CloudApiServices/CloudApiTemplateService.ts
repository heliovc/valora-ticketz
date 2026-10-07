import axios from "axios";
import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { CHANNEL, conexaoDoTicket, getToken, graphUrl } from "./CloudApiChannel";
import { sendTemplate } from "./CloudApiSendService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import ShowContactService from "../ContactServices/ShowContactService";

/**
 * Modelos de mensagem (templates) do WhatsApp Oficial.
 *
 * Fonte de verdade é a Meta: o CRM não guarda cópia. Listar é perguntar à Meta
 * — e por isso "importar os modelos criados no painel dela" é simplesmente
 * listá-los: todo modelo da conta aparece aqui, com o status de aprovação de
 * agora, sem sincronização que possa ficar velha.
 *
 * A conta é a WABA da conexão (`cloudApiWabaId`), sempre da empresa de quem
 * pede — nunca um id que veio da tela.
 */

export interface Modelo {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejectedReason?: string;
  header?: string;
  body: string;
  footer?: string;
  buttons: Array<{ type: string; text: string; url?: string }>;
  /** Quantos `{{n}}` o corpo pede, na ordem. */
  variaveis: number;
}

/** A conexão oficial pedida, só se for da empresa e tiver conta (WABA). */
export async function conexaoOficialDaEmpresa(
  companyId: number,
  whatsappId?: number | string | null
): Promise<Whatsapp> {
  const where: Record<string, unknown> = { companyId, channel: CHANNEL };
  if (whatsappId) where.id = Number(whatsappId);
  const conexao = await Whatsapp.findOne({ where, order: [["id", "ASC"]] });
  if (!conexao) {
    throw new AppError("Conexão do WhatsApp Oficial não encontrada.", 404);
  }
  if (!conexao.cloudApiWabaId) {
    throw new AppError(
      "Esta conexão não tem o identificador da conta do WhatsApp (WABA ID). Preencha em CRM → Canais → WhatsApp Oficial.",
      400
    );
  }
  return conexao;
}

function erroDaMeta(err: any, padrao: string): AppError {
  const meta = err?.response?.data?.error;
  logger.warn({ status: err?.response?.status, meta }, `CloudApi: ${padrao}`);
  const detalhe = meta?.error_user_msg || meta?.error_user_title || meta?.message;
  return new AppError(detalhe ? `${padrao}: ${detalhe}` : padrao, 400);
}

const contarVariaveis = (texto: string): number => {
  const numeros = Array.from(texto.matchAll(/\{\{(\d+)\}\}/g)).map(m => Number(m[1]));
  return numeros.length ? Math.max(...numeros) : 0;
};

function normalizar(bruto: any): Modelo {
  const comps: any[] = bruto?.components || [];
  const header = comps.find(c => c.type === "HEADER" && c.format === "TEXT");
  const body = comps.find(c => c.type === "BODY");
  const footer = comps.find(c => c.type === "FOOTER");
  const botoes = comps.find(c => c.type === "BUTTONS");
  const texto = body?.text || "";
  return {
    id: bruto.id,
    name: bruto.name,
    status: bruto.status,
    category: bruto.category,
    language: bruto.language,
    rejectedReason:
      bruto.rejected_reason && bruto.rejected_reason !== "NONE"
        ? bruto.rejected_reason
        : undefined,
    header: header?.text,
    body: texto,
    footer: footer?.text,
    buttons: (botoes?.buttons || []).map((b: any) => ({
      type: b.type,
      text: b.text,
      url: b.url
    })),
    variaveis: contarVariaveis(texto)
  };
}

/** Todos os modelos da conta, com o status de aprovação atual. */
export async function listarModelos(
  companyId: number,
  whatsappId?: number | string | null
): Promise<Modelo[]> {
  const conexao = await conexaoOficialDaEmpresa(companyId, whatsappId);
  const token = getToken(conexao);
  const modelos: Modelo[] = [];
  let url: string | null = graphUrl(`${conexao.cloudApiWabaId}/message_templates`);
  let params: Record<string, unknown> | undefined = {
    fields: "id,name,status,category,language,components,rejected_reason",
    limit: 100
  };
  try {
    // Paginação da Graph API: `paging.next` já traz a query inteira.
    for (let pagina = 0; url && pagina < 20; pagina += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { data } = await axios.get(url, {
        params,
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      });
      modelos.push(...(data?.data || []).map(normalizar));
      url = data?.paging?.next || null;
      params = undefined;
    }
  } catch (err) {
    throw erroDaMeta(err, "A Meta não devolveu os modelos");
  }
  return modelos.sort((a, b) => a.name.localeCompare(b.name));
}

export interface NovoModelo {
  whatsappId?: number;
  name: string;
  category: string;
  language?: string;
  header?: string;
  body: string;
  footer?: string;
  /** Um exemplo por variável `{{n}}` do corpo, na ordem — a Meta exige. */
  exemplos?: string[];
  buttons?: Array<{ type: "QUICK_REPLY" | "URL"; text: string; url?: string }>;
}

const CATEGORIAS = ["MARKETING", "UTILITY"];

/**
 * Submete um modelo novo para aprovação da Meta.
 *
 * As regras abaixo são as que a Meta mais recusa — conferir aqui devolve o
 * erro em português, na hora, em vez de um "Invalid parameter" depois.
 */
export async function criarModelo(
  companyId: number,
  dados: NovoModelo
): Promise<{ id: string; status: string; name: string }> {
  const name = String(dados.name || "").trim();
  if (!/^[a-z0-9_]{1,512}$/.test(name)) {
    throw new AppError(
      "O nome do modelo só pode ter letras minúsculas sem acento, números e _ (ex.: boas_vindas_cliente).",
      400
    );
  }
  const category = String(dados.category || "").toUpperCase();
  if (!CATEGORIAS.includes(category)) {
    throw new AppError("Escolha a categoria: Marketing ou Utilidade.", 400);
  }
  const body = String(dados.body || "").trim();
  if (!body) throw new AppError("O texto do modelo não pode ficar vazio.", 400);
  if (body.length > 1024) {
    throw new AppError("O texto do modelo passa de 1024 caracteres.", 400);
  }
  const variaveis = contarVariaveis(body);
  for (let n = 1; n <= variaveis; n += 1) {
    if (!body.includes(`{{${n}}}`)) {
      throw new AppError(
        `As variáveis precisam ser seguidas: falta {{${n}}} no texto.`,
        400
      );
    }
  }
  if (/^\s*\{\{\d+\}\}|\{\{\d+\}\}\s*$/.test(body)) {
    throw new AppError(
      "A Meta recusa modelo que começa ou termina com variável. Ponha texto antes e depois.",
      400
    );
  }
  const exemplos = (dados.exemplos || []).map(e => String(e || "").trim());
  if (variaveis > 0 && exemplos.filter(Boolean).length < variaveis) {
    throw new AppError(
      `Preencha um exemplo para cada variável ({{1}} a {{${variaveis}}}). A Meta usa os exemplos para aprovar.`,
      400
    );
  }
  const header = String(dados.header || "").trim();
  if (header && /\{\{\d+\}\}/.test(header)) {
    throw new AppError("O título não aceita variáveis nesta versão.", 400);
  }
  if (header.length > 60) throw new AppError("O título passa de 60 caracteres.", 400);
  const footer = String(dados.footer || "").trim();
  if (footer.length > 60) throw new AppError("O rodapé passa de 60 caracteres.", 400);

  const components: any[] = [];
  if (header) components.push({ type: "HEADER", format: "TEXT", text: header });
  components.push({
    type: "BODY",
    text: body,
    ...(variaveis ? { example: { body_text: [exemplos.slice(0, variaveis)] } } : {})
  });
  if (footer) components.push({ type: "FOOTER", text: footer });
  const botoes = (dados.buttons || []).filter(b => b && String(b.text || "").trim());
  if (botoes.length) {
    if (botoes.length > 3) throw new AppError("No máximo 3 botões.", 400);
    components.push({
      type: "BUTTONS",
      buttons: botoes.map(b => {
        const text = String(b.text).trim().slice(0, 25);
        if (b.type === "URL") {
          const url = String(b.url || "").trim();
          if (!/^https:\/\//.test(url)) {
            throw new AppError("O botão de link precisa de um endereço https://.", 400);
          }
          return { type: "URL", text, url };
        }
        return { type: "QUICK_REPLY", text };
      })
    });
  }

  const conexao = await conexaoOficialDaEmpresa(companyId, dados.whatsappId);
  try {
    const { data } = await axios.post(
      graphUrl(`${conexao.cloudApiWabaId}/message_templates`),
      {
        name,
        category,
        language: dados.language || "pt_BR",
        components
      },
      { headers: { Authorization: `Bearer ${getToken(conexao)}` }, timeout: 20000 }
    );
    return { id: data?.id, status: data?.status, name };
  } catch (err) {
    throw erroDaMeta(err, "A Meta recusou o modelo");
  }
}

/** Apaga o modelo na Meta (todas as línguas daquele nome). */
export async function apagarModelo(
  companyId: number,
  whatsappId: number | string | undefined,
  name: string
): Promise<void> {
  const conexao = await conexaoOficialDaEmpresa(companyId, whatsappId);
  try {
    await axios.delete(graphUrl(`${conexao.cloudApiWabaId}/message_templates`), {
      params: { name },
      headers: { Authorization: `Bearer ${getToken(conexao)}` },
      timeout: 20000
    });
  } catch (err) {
    throw erroDaMeta(err, "A Meta não apagou o modelo");
  }
}

/** O modelo aprovado pelo nome e língua — recusa o que não está aprovado. */
export async function modeloAprovado(
  companyId: number,
  whatsappId: number | string | undefined,
  name: string,
  language: string
): Promise<Modelo> {
  const modelos = await listarModelos(companyId, whatsappId);
  const modelo = modelos.find(
    m => m.name === name && (!language || m.language === language)
  );
  if (!modelo) throw new AppError("Modelo não encontrado nesta conta.", 404);
  if (modelo.status !== "APPROVED") {
    throw new AppError(
      `Este modelo ainda não pode ser usado: a Meta marcou como ${modelo.status}.`,
      400
    );
  }
  return modelo;
}

/** O texto que o cliente vai ler, com as variáveis já trocadas. */
export function textoDoModelo(modelo: Modelo, params: string[]): string {
  const corpo = modelo.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? "");
  return [modelo.header, corpo, modelo.footer].filter(Boolean).join("\n\n");
}

/** A Meta recusa parâmetro com quebra de linha, tabulação ou 4+ espaços. */
export function limparParametro(valor: string): string {
  return String(valor ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {4,}/g, "   ")
    .trim();
}

/**
 * Envia um modelo aprovado numa conversa — o caminho para falar com quem não
 * escreveu nas últimas 24h. Sai pela conexão do próprio card.
 */
export async function enviarModeloNaConversa(
  companyId: number,
  ticketId: number,
  name: string,
  language: string,
  paramsBrutos: string[]
): Promise<void> {
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) throw new AppError("ERR_NO_TICKET_FOUND", 404);
  if (ticket.channel !== CHANNEL) {
    throw new AppError("Modelos só existem em conversas do WhatsApp Oficial.", 400);
  }
  const conexao = await conexaoDoTicket(ticket);
  if (!conexao) throw new AppError("Conexão do WhatsApp Oficial não encontrada.", 404);

  const modelo = await modeloAprovado(companyId, conexao.id, name, language);
  const params = (paramsBrutos || []).map(limparParametro);
  if (params.filter(Boolean).length < modelo.variaveis) {
    throw new AppError(`Preencha as ${modelo.variaveis} variáveis do modelo.`, 400);
  }
  const contato = await ShowContactService(ticket.contactId, companyId);
  const { wamid } = await sendTemplate(
    conexao,
    contato.number,
    modelo.name,
    modelo.language,
    params.slice(0, modelo.variaveis)
  );

  await CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: ticket.contactId,
      body: textoDoModelo(modelo, params),
      fromMe: true,
      read: true,
      ack: 1,
      channel: CHANNEL
    },
    companyId
  });
}
