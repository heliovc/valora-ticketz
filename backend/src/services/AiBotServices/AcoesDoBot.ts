import { Op } from "sequelize";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import Setting from "../../models/Setting";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { ticketTagAdd, ticketTagRemove } from "../TicketTagServices/TicketTagServices";
import {
  CampoQualificavel,
  ContextoDeNota,
  NotaDoLead,
  blocoDeQualificacao,
  estadoDaQualificacao,
  notaDoLead,
  temQualificacao,
  validarValor
} from "../../helpers/qualificacao";

/**
 * Ações que o bot pode executar, configuradas por CONTA:
 *
 *   [[MOVER lista="Fechamento"]]                    → card vai para a lista
 *   [[SALVAR campo="CNPJ" valor="12.345.678/0001-90"]] → dado salvo no contato
 *
 * QUANDO agir é regra do usuário, escrita na Personalidade ("quando o lead
 * aceitar a proposta, mova para Fechamento"). O sistema só garante que a ação
 * fica dentro da conta e do quadro do card, e que marcador nenhum chega ao
 * cliente.
 *
 * Campos com metadados de qualificação (tipo, a quem se aplica, obrigatório,
 * ordem — ver `helpers/qualificacao.ts`) mudam o jogo: o motor passa a dizer
 * ao modelo QUAL é a próxima pergunta, valida o valor antes de gravar e dá a
 * nota do lead (quente/morno/frio) como etiqueta do card.
 */

const CHAVE_CAMPOS = "aiBotFields";
const CHAVE_NOTA = "aiBotLeadScore";
const CAMPO_NOTA = "nota_lead";
const MAX_CAMPOS = 20;
const MAX_VALOR = 300;
const TIPOS: CampoQualificavel["tipo"][] = ["texto", "data", "numero", "moeda", "opcao", "sim_nao"];

export type CampoDoBot = CampoQualificavel;

const ETIQUETAS_DE_NOTA: Record<NotaDoLead, { name: string; color: string }> = {
  quente: { name: "Lead quente", color: "#E74C3C" },
  morno: { name: "Lead morno", color: "#F39C12" },
  frio: { name: "Lead frio", color: "#3498DB" }
};

const normal = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// ── Configuração dos campos (por empresa) ───────────────────────────

export async function camposDoBot(companyId: number): Promise<CampoDoBot[]> {
  const s = await Setting.findOne({ where: { companyId, key: CHAVE_CAMPOS } });
  if (!s?.value) return [];
  try {
    const lista = JSON.parse(s.value);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export async function salvarCamposDoBot(companyId: number, campos: CampoDoBot[]): Promise<CampoDoBot[]> {
  if (!Array.isArray(campos)) throw new AppError("Lista de campos inválida.", 400);
  if (campos.length > MAX_CAMPOS) throw new AppError(`No máximo ${MAX_CAMPOS} campos.`, 400);
  const vistos = new Set<string>();
  const limpos = campos
    .map(c => {
      const limpo: CampoDoBot = {
        nome: String(c?.nome || "").replace(/["\[\]\n]/g, "").trim().slice(0, 40),
        descricao: String(c?.descricao || "").replace(/\n/g, " ").trim().slice(0, 160)
      };
      // Metadados de qualificação: só entram se vierem válidos.
      if (c?.tipo && TIPOS.includes(c.tipo)) limpo.tipo = c.tipo;
      if (Array.isArray(c?.aplicaA)) limpo.aplicaA = c.aplicaA.map(a => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
      if (typeof c?.obrigatorio === "boolean") limpo.obrigatorio = c.obrigatorio;
      if (Number.isFinite(c?.ordem)) limpo.ordem = Number(c.ordem);
      if (Array.isArray(c?.opcoes)) limpo.opcoes = c.opcoes.map(o => String(o).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
      return limpo;
    })
    .filter(c => {
      if (!c.nome || vistos.has(normal(c.nome))) return false;
      vistos.add(normal(c.nome));
      return true;
    });
  const [s] = await Setting.findOrCreate({
    where: { companyId, key: CHAVE_CAMPOS },
    defaults: { companyId, key: CHAVE_CAMPOS, value: "[]" } as any
  });
  await s.update({ value: JSON.stringify(limpos) });
  return limpos;
}

/** Contexto de nota gravado pela Valora (capacidade e piso por tipo). Vazio = nota sem esses critérios. */
async function contextoDeNota(companyId: number): Promise<ContextoDeNota> {
  const s = await Setting.findOne({ where: { companyId, key: CHAVE_NOTA } });
  if (!s?.value) return {};
  try {
    const ctx = JSON.parse(s.value);
    return ctx && typeof ctx === "object" ? ctx : {};
  } catch {
    return {};
  }
}

async function dadosSalvos(contactId: number): Promise<Record<string, string>> {
  const salvos = await ContactCustomField.findAll({ where: { contactId } });
  const mapa: Record<string, string> = {};
  for (const s of salvos) if (s.value && s.value.trim()) mapa[s.name] = s.value.trim();
  return mapa;
}

// ── Quadro do card ─────────────────────────────────────────

async function listasDoQuadro(ticket: Ticket): Promise<Tag[]> {
  const conexao = ticket.whatsappId
    ? await Whatsapp.findOne({
        where: { id: ticket.whatsappId, companyId: ticket.companyId },
        attributes: ["id", "ownBoard"]
      })
    : null;
  return Tag.findAll({
    where: {
      companyId: ticket.companyId,
      kanban: 1,
      whatsappId: conexao?.ownBoard ? conexao.id : null
    } as any,
    order: [["name", "ASC"]]
  });
}

/**
 * O que o bot precisa saber para agir: listas do quadro do card, campos que a
 * conta pede para coletar e o que o contato já tem salvo. Vazio quando não há
 * nada configurado — o prompt fica igual ao de antes.
 */
export async function contextoDeAcoes(ticketId: number, companyId: number): Promise<string> {
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  if (!ticket) return "";
  const [listas, campos, salvos] = await Promise.all([
    listasDoQuadro(ticket),
    camposDoBot(companyId),
    dadosSalvos(ticket.contactId)
  ]);
  const partes: string[] = [];
  if (listas.length || campos.length) partes.push(
    "Você executa ações escrevendo COMANDOS em linhas separadas da sua resposta. O sistema executa e apaga o comando antes de enviar — o cliente nunca vê. O texto para o cliente vem fora dos comandos, nas outras linhas."
  );
  if (listas.length) {
    partes.push(
      [
        "MOVER — listas (etapas) deste funil: " + listas.map(l => `"${l.name}"`).join(", ") + ".",
        'Comando: [[MOVER lista="Nome exato da lista"]]',
        "Use sempre que uma regra da Personalidade disser para mover (ex.: cliente aceitou a proposta, quer contratar)."
      ].join("\n")
    );
  }
  const qualificando = temQualificacao(campos);
  if (campos.length) {
    const ctx = qualificando ? await contextoDeNota(companyId) : {};
    const estado = qualificando ? estadoDaQualificacao(campos, salvos, ctx.seletor) : null;
    // Com qualificação, o modelo só vê os campos que valem para este lead.
    const visiveis = estado ? estado.aplicaveis : campos;
    partes.push(
      [
        "SALVAR — dados a guardar no cadastro deste cliente:",
        ...visiveis.map(c => `- ${c.nome}${c.descricao ? `: ${c.descricao}` : ""}${c.opcoes?.length ? ` (opções: ${c.opcoes.join(", ")})` : ""}`),
        'Comando: [[SALVAR campo="Nome do campo" valor="o que o cliente informou"]]',
        "OBRIGATÓRIO: toda vez que o cliente informar um desses dados, escreva um comando SALVAR para cada dado, na mesma resposta, sem pedir confirmação. Use o valor como o cliente disse; o sistema interpreta datas, números e opções."
      ].join("\n")
    );
    if (estado) {
      partes.push(blocoDeQualificacao(estado, salvos, notaDoLead(salvos, ctx)));
    }
  }
  if (listas.length || campos.length) {
    partes.push(
      [
        "Exemplo — cliente: \"Quero contratar, meu CNPJ é 12.345.678/0001-90\". Sua resposta:",
        "Que ótimo! Não temos custo de adesão nem fidelidade. Vou te passar o link do cadastro.",
        '[[SALVAR campo="CNPJ" valor="12.345.678/0001-90"]]',
        '[[MOVER lista="Fechamento"]]',
        "(o exemplo usa nomes ilustrativos — use os campos e listas desta conta)"
      ].join("\n")
    );
  }
  if (!qualificando) {
    const preenchidos = Object.entries(salvos);
    if (preenchidos.length) {
      partes.push(
        "Dados que este cliente JÁ informou (não pergunte de novo):\n" +
          preenchidos.map(([nome, valor]) => `- ${nome}: ${valor}`).join("\n")
      );
    }
  }
  return partes.join("\n\n");
}

// ── Execução ───────────────────────────────────────────

const MARCADOR = /\[\[\s*(MOVER|SALVAR)\b([^\]]*)\]\]/gi;

function atributos(bruto: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const m of bruto.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g)) {
    r[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  return r;
}

/** Remove qualquer [[...]] que tenha sobrado — o cliente nunca vê comando. */
export function limparMarcadores(texto: string): string {
  return String(texto || "")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function mover(ticket: Ticket, nomeDaLista: string): Promise<string> {
  const listas = await listasDoQuadro(ticket);
  const destino = listas.find(l => normal(l.name) === normal(nomeDaLista));
  if (!destino) return `lista "${nomeDaLista}" não existe neste quadro`;
  const marcas = await TicketTag.findAll({
    where: { ticketId: ticket.id, tagId: { [Op.in]: listas.map(l => l.id) } }
  });
  if (marcas.some(m => m.tagId === destino.id)) return `já estava em "${destino.name}"`;
  if (ticket.status === "pending") await ticket.update({ status: "open" });
  for (const m of marcas) {
    // eslint-disable-next-line no-await-in-loop
    await ticketTagRemove(ticket.id, m.tagId, ticket.companyId);
  }
  // Pela porta de sempre: as automações da lista de destino disparam.
  await ticketTagAdd(ticket.id, destino.id, ticket.companyId);
  return `movido para "${destino.name}"`;
}

async function gravarCampo(contactId: number, nome: string, valor: string): Promise<void> {
  const existente = await ContactCustomField.findOne({ where: { contactId, name: nome } });
  if (existente) await existente.update({ value: valor });
  else await ContactCustomField.create({ contactId, name: nome, value: valor } as any);
}

async function salvar(ticket: Ticket, campo: string, valor: string): Promise<string> {
  const campos = await camposDoBot(ticket.companyId);
  const configurado = campos.find(c => normal(c.nome) === normal(campo));
  if (!configurado) return `campo "${campo}" não está configurado`;
  const limpo = String(valor || "").replace(/\s+/g, " ").trim().slice(0, MAX_VALOR);
  if (!limpo) return `valor vazio para "${campo}"`;
  // Campo com tipo: o valor é interpretado (data → ISO, "30 mil" → 30000,
  // "festa de 15" → 15_anos). Inválido não grava: na próxima rodada o campo
  // continua "(falta)" e o bot pergunta de novo, de outro jeito.
  const validacao = validarValor(configurado, limpo);
  if (validacao.ok === false) return `valor recusado para "${configurado.nome}": ${validacao.motivo}`;
  // O contato é o da conversa, conferido na mesma empresa.
  const contato = await Contact.findOne({ where: { id: ticket.contactId, companyId: ticket.companyId } });
  if (!contato) return "contato não encontrado";
  await gravarCampo(contato.id, configurado.nome, validacao.valor);
  const nota = await atualizarNotaDoLead(ticket, contato.id, campos);
  return `${configurado.nome} = ${validacao.valor} salvo${nota ? ` · nota ${nota}` : ""}`;
}

/**
 * Recalcula a nota do lead e a põe como etiqueta no card (uma das três), além
 * do campo `nota_lead` no contato. Só quando os campos têm qualificação.
 */
export async function atualizarNotaDoLead(
  ticket: Ticket,
  contactId: number,
  campos?: CampoDoBot[]
): Promise<NotaDoLead | null> {
  const lista = campos ?? (await camposDoBot(ticket.companyId));
  if (!temQualificacao(lista)) return null;
  const [salvos, ctx] = await Promise.all([dadosSalvos(contactId), contextoDeNota(ticket.companyId)]);
  const nota = notaDoLead(salvos, ctx);
  if (!nota) return null;
  if (salvos[CAMPO_NOTA] === nota) return nota;
  await gravarCampo(contactId, CAMPO_NOTA, nota);
  try {
    const etiquetas: Record<NotaDoLead, Tag> = {} as any;
    for (const n of Object.keys(ETIQUETAS_DE_NOTA) as NotaDoLead[]) {
      const def = ETIQUETAS_DE_NOTA[n];
      // eslint-disable-next-line no-await-in-loop
      const [tag] = await Tag.findOrCreate({
        where: { companyId: ticket.companyId, name: def.name, kanban: 0 } as any,
        defaults: { companyId: ticket.companyId, name: def.name, color: def.color, kanban: 0 } as any
      });
      etiquetas[n] = tag;
    }
    const atuais = await TicketTag.findAll({
      where: { ticketId: ticket.id, tagId: { [Op.in]: Object.values(etiquetas).map(t => t.id) } }
    });
    for (const m of atuais) {
      if (m.tagId !== etiquetas[nota].id) {
        // eslint-disable-next-line no-await-in-loop
        await ticketTagRemove(ticket.id, m.tagId, ticket.companyId);
      }
    }
    if (!atuais.some(m => m.tagId === etiquetas[nota].id)) {
      await ticketTagAdd(ticket.id, etiquetas[nota].id, ticket.companyId);
    }
  } catch (err: any) {
    logger.warn({ ticketId: ticket.id, message: err?.message }, "[aiBot] etiqueta de nota não aplicada");
  }
  logger.info(`[aiBot] nota do lead ticket=${ticket.id}: ${nota}`);
  return nota;
}

/**
 * Executa os comandos MOVER/SALVAR da resposta e devolve o texto sem eles.
 * `[[SIMULAR]]` fica no texto — é tratado depois, por quem envia a imagem.
 * Nunca lança: ação que falha vira log, a resposta segue para o cliente.
 */
export async function executarAcoesDoBot(
  ticketId: number,
  companyId: number,
  texto: string
): Promise<string> {
  const achados = Array.from(String(texto || "").matchAll(MARCADOR));
  if (!achados.length) return texto;
  const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
  for (const [, verbo, bruto] of achados) {
    try {
      const a = atributos(bruto);
      const resultado = !ticket
        ? "conversa não encontrada"
        : verbo.toUpperCase() === "MOVER"
        ? // eslint-disable-next-line no-await-in-loop
          await mover(ticket, a.lista || a.nome || "")
        : // eslint-disable-next-line no-await-in-loop
          await salvar(ticket, a.campo || "", a.valor || "");
      logger.info(`[aiBot] ação ${verbo.toUpperCase()} ticket=${ticketId}: ${resultado}`);
    } catch (err: any) {
      logger.error({ ticketId, verbo, message: err?.message }, "[aiBot] ação do bot falhou");
    }
  }
  return String(texto).replace(MARCADOR, "").replace(/\n{3,}/g, "\n\n").trim();
}
