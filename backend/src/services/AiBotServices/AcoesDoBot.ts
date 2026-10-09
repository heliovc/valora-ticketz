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
 */

const CHAVE_CAMPOS = "aiBotFields";
const MAX_CAMPOS = 20;
const MAX_VALOR = 300;

export interface CampoDoBot {
  nome: string;
  descricao: string;
}

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
    .map(c => ({
      nome: String(c?.nome || "").replace(/["\[\]\n]/g, "").trim().slice(0, 40),
      descricao: String(c?.descricao || "").replace(/\n/g, " ").trim().slice(0, 160)
    }))
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

// ── Quadro do card ─────────────────────────────────────────────────
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
    ContactCustomField.findAll({ where: { contactId: ticket.contactId } })
  ]);
  const partes: string[] = [];
  if (listas.length || campos.length) partes.push(
    "Você executa ações escrevendo COMANDOS em linhas separadas da sua resposta. O sistema executa e apaga o comando antes de enviar — o cliente nunca vê. Escreva o comando NA MESMA resposta em que a situação acontece, junto com o texto normal para o cliente."
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
  if (campos.length) {
    partes.push(
      [
        "SALVAR — dados a guardar no cadastro deste cliente:",
        ...campos.map(c => `- ${c.nome}${c.descricao ? `: ${c.descricao}` : ""}`),
        'Comando: [[SALVAR campo="Nome do campo" valor="o que o cliente informou"]]',
        "OBRIGATÓRIO: toda vez que o cliente informar um desses dados, escreva um comando SALVAR para cada dado, na mesma resposta, sem pedir confirmação."
      ].join("\n")
    );
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
  const preenchidos = salvos.filter(s => s.value && s.value.trim());
  if (preenchidos.length) {
    partes.push(
      "Dados que este cliente JÁ informou (não pergunte de novo):\n" +
        preenchidos.map(s => `- ${s.name}: ${s.value}`).join("\n")
    );
  }
  return partes.join("\n\n");
}

// ── Execução ───────────────────────────────────────────────────────
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

async function salvar(ticket: Ticket, campo: string, valor: string): Promise<string> {
  const campos = await camposDoBot(ticket.companyId);
  const configurado = campos.find(c => normal(c.nome) === normal(campo));
  if (!configurado) return `campo "${campo}" não está configurado`;
  const limpo = String(valor || "").replace(/\s+/g, " ").trim().slice(0, MAX_VALOR);
  if (!limpo) return `valor vazio para "${campo}"`;
  // O contato é o da conversa, conferido na mesma empresa.
  const contato = await Contact.findOne({ where: { id: ticket.contactId, companyId: ticket.companyId } });
  if (!contato) return "contato não encontrado";
  const existente = await ContactCustomField.findOne({
    where: { contactId: contato.id, name: configurado.nome }
  });
  if (existente) await existente.update({ value: limpo });
  else await ContactCustomField.create({ contactId: contato.id, name: configurado.nome, value: limpo } as any);
  return `${configurado.nome} salvo`;
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
