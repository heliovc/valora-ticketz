import { Request, Response } from "express";
import { Op, QueryTypes } from "sequelize";
import AppError from "../errors/AppError";
import sequelize from "../database";
import Contact from "../models/Contact";
import FunnelAction from "../models/FunnelAction";
import Queue from "../models/Queue";
import Setting from "../models/Setting";
import Tag from "../models/Tag";
import TagAutomationRun from "../models/TagAutomationRun";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import {
  AiDecisionLog,
  CampaignListMember,
  CampaignRef,
  SalesAiConfig,
  SalesPlaybookVersion
} from "../models/SalesAi";
import {
  aplicarComandoVal,
  chaveDoAmbiente,
  configDaEmpresa
} from "../services/SalesAiServices/SalesAiService";
import {
  ETAPAS_DE_VENDAS,
  REGRAS_PADRAO,
  linkDoWhatsapp,
  lerComandoVal,
  normalizarTelefone,
  regrasCompletas,
  textoPadraoDoCodigo
} from "../services/SalesAiServices/salesAiRules";
import { CATALOGO_DO_CRM, SETTINGS_DE_ESTADO } from "../services/SalesAiServices/catalogoDeAutomacoes";

/**
 * Painel da Val Vendas (só admin da empresa). Quem chama em produção é o
 * Valora Smart, como o dono do tenant; a auditoria de quem mudou o quê fica
 * no Smart, que sabe qual usuário clicou.
 */

const CAMPOS_EDITAVEIS: Array<keyof SalesAiConfig> = [
  "enabled",
  "whatsappIds",
  "campaignStartAt",
  "listWindowDays",
  "refCodeScanMessages",
  "humanPauseMinutes",
  "valCommandsEnabled",
  "maxAiMessagesPerConversation",
  "maxAiMessagesPerMinute",
  "rules",
  "businessHours",
  "handoff",
  "prospecting",
  "protocol"
];

function inteiro(v: unknown, min: number, max: number, campo: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new AppError(`${campo}: use um número entre ${min} e ${max}.`, 400);
  return Math.round(n);
}

async function serializarConfig(cfg: SalesAiConfig) {
  const json = cfg.toJSON() as any;
  return { ...json, rules: regrasCompletas(json.rules), chaveDoAmbiente: chaveDoAmbiente(), regrasPadrao: REGRAS_PADRAO };
}

export const showConfig = async (req: Request, res: Response): Promise<Response> => {
  const cfg = await configDaEmpresa(req.user.companyId, true);
  return res.json(await serializarConfig(cfg));
};

export const updateConfig = async (req: Request, res: Response): Promise<Response> => {
  const cfg = await configDaEmpresa(req.user.companyId, true);
  const corpo = req.body || {};
  const mudancas: Record<string, unknown> = {};
  for (const k of CAMPOS_EDITAVEIS) {
    if (corpo[k] === undefined) continue;
    mudancas[k] = corpo[k];
  }
  if (mudancas.listWindowDays !== undefined) mudancas.listWindowDays = inteiro(mudancas.listWindowDays, 0, 365, "Janela da lista (dias)");
  if (mudancas.refCodeScanMessages !== undefined) mudancas.refCodeScanMessages = inteiro(mudancas.refCodeScanMessages, 1, 20, "Mensagens analisadas");
  if (mudancas.humanPauseMinutes !== undefined) mudancas.humanPauseMinutes = inteiro(mudancas.humanPauseMinutes, 0, 60 * 24 * 30, "Pausa após humano (minutos)");
  if (mudancas.maxAiMessagesPerConversation !== undefined) mudancas.maxAiMessagesPerConversation = inteiro(mudancas.maxAiMessagesPerConversation, 0, 1000, "Máx. por conversa");
  if (mudancas.maxAiMessagesPerMinute !== undefined) mudancas.maxAiMessagesPerMinute = inteiro(mudancas.maxAiMessagesPerMinute, 0, 600, "Máx. por minuto");
  if (mudancas.whatsappIds !== undefined) {
    if (!Array.isArray(mudancas.whatsappIds)) throw new AppError("Conexões: envie a lista de ids.", 400);
    const ids = (mudancas.whatsappIds as unknown[]).map(Number).filter(Number.isFinite);
    const validas = await Whatsapp.count({ where: { id: ids, companyId: req.user.companyId } });
    if (validas !== ids.length) throw new AppError("Alguma conexão não é desta empresa.", 400);
    mudancas.whatsappIds = ids;
  }
  if (mudancas.rules !== undefined) mudancas.rules = regrasCompletas(mudancas.rules as Record<string, unknown>);
  await cfg.update(mudancas as any);
  return res.json(await serializarConfig(cfg));
};

export const listConnections = async (req: Request, res: Response): Promise<Response> => {
  const conexoes = await Whatsapp.findAll({
    where: { companyId: req.user.companyId },
    attributes: ["id", "name", "status", "channel", "isDefault", "greetingMessage", "outOfHoursMessage", "complationMessage", "ratingMessage"],
    include: [{ model: Queue, as: "queues", attributes: ["id", "name"] }],
    order: [["id", "ASC"]]
  });
  return res.json(
    conexoes.map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
      channel: w.channel,
      isDefault: w.isDefault,
      respostasAutomaticas: {
        saudacao: !!w.greetingMessage?.trim(),
        foraDoExpediente: !!w.outOfHoursMessage?.trim(),
        finalizacao: !!w.complationMessage?.trim(),
        avaliacao: !!w.ratingMessage?.trim(),
        filas: (w.queues || []).length
      }
    }))
  );
};

// ── Códigos de campanha ─────────────────────────────────────────────────────

const CODIGO_VALIDO = /^ELO-[A-Z0-9-]{2,40}$/;

export const listRefs = async (req: Request, res: Response): Promise<Response> => {
  await configDaEmpresa(req.user.companyId, true);
  const refs = await CampaignRef.findAll({ where: { companyId: req.user.companyId }, order: [["code", "ASC"]] });
  const numero = String(req.query.numero || "");
  const contagem: Array<{ campaignRef: string; total: string }> = await sequelize.query(
    `SELECT "campaignRef", COUNT(*)::text AS total FROM "Tickets" WHERE "companyId" = :c AND "salesSource" = 'elo_eventos' GROUP BY "campaignRef"`,
    { replacements: { c: req.user.companyId }, type: QueryTypes.SELECT }
  );
  return res.json(
    refs.map(r => ({
      ...r.toJSON(),
      leads: Number(contagem.find(x => x.campaignRef === r.code)?.total || 0),
      link: numero ? linkDoWhatsapp(numero, r.prefilledText || textoPadraoDoCodigo(r.code)) : null
    }))
  );
};

export const saveRef = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const id = req.params.id ? Number(req.params.id) : null;
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!CODIGO_VALIDO.test(code)) throw new AppError("Código inválido. Use ELO- seguido de letras, números e hífen (ex.: ELO-EM4).", 400);
  const dados = {
    companyId,
    code,
    channel: String(req.body?.channel || "outro").slice(0, 40),
    campaignName: String(req.body?.campaignName || code).slice(0, 160),
    prefilledText: req.body?.prefilledText ? String(req.body.prefilledText) : textoPadraoDoCodigo(code),
    active: req.body?.active !== false
  };
  if (id) {
    const ref = await CampaignRef.findOne({ where: { id, companyId } });
    if (!ref) throw new AppError("Código não encontrado.", 404);
    await ref.update(dados as any);
    return res.json(ref);
  }
  const existe = await CampaignRef.findOne({ where: { companyId, code } });
  if (existe) throw new AppError("Esse código já existe.", 400);
  return res.status(201).json(await CampaignRef.create(dados as any));
};

export const deleteRef = async (req: Request, res: Response): Promise<Response> => {
  const ref = await CampaignRef.findOne({ where: { id: Number(req.params.id), companyId: req.user.companyId } });
  if (!ref) throw new AppError("Código não encontrado.", 404);
  // Apagar perde o histórico do nome; desativar mantém. Aqui só desativa.
  await ref.update({ active: false } as any);
  return res.json(ref);
};

// ── Contatos pessoais ───────────────────────────────────────────────────────

export const listPersonal = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const busca = String(req.query.busca || "").trim();
  const soPessoais = req.query.pessoais === "1";
  const where: any = { companyId, isGroup: false };
  if (soPessoais) where.isPersonal = true;
  if (busca) where[Op.or] = [{ name: { [Op.iLike]: `%${busca}%` } }, { number: { [Op.iLike]: `%${busca.replace(/\D/g, "") || busca}%` } }];
  const contatos = await Contact.findAll({ where, attributes: ["id", "name", "number", "isPersonal", "updatedAt"], order: [["name", "ASC"]], limit: 200 });
  const total = await Contact.count({ where: { companyId, isPersonal: true } });
  return res.json({ totalPessoais: total, contatos });
};

export const setPersonal = async (req: Request, res: Response): Promise<Response> => {
  const contato = await Contact.findOne({ where: { id: Number(req.params.contactId), companyId: req.user.companyId } });
  if (!contato) throw new AppError("Contato não encontrado.", 404);
  await contato.update({ isPersonal: !!req.body?.isPersonal } as any);
  return res.json({ id: contato.id, isPersonal: contato.isPersonal });
};

export const bulkPersonal = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const valor = req.body?.isPersonal !== false;
  const ids: number[] = Array.isArray(req.body?.contactIds) ? req.body.contactIds.map(Number) : [];
  const numeros: string[] = Array.isArray(req.body?.numeros) ? req.body.numeros.map(normalizarTelefone).filter(Boolean) : [];
  let afetados = 0;
  if (ids.length) [afetados] = await Contact.update({ isPersonal: valor } as any, { where: { companyId, id: ids } });
  if (numeros.length) {
    const [n] = await Contact.update({ isPersonal: valor } as any, { where: { companyId, number: numeros } });
    afetados += n;
  }
  return res.json({ afetados, numerosNaoEncontrados: numeros.length ? undefined : 0 });
};

/**
 * Sugestão inicial de pessoais (decisão do Hélio, 26/10): quem conversou antes
 * da data de início da campanha E nunca esteve numa lista de campanha nem numa
 * lista do funil com "disparo" no nome. O Hélio revisa antes de aplicar.
 */
async function sugestaoDePessoais(companyId: number) {
  const cfg = await configDaEmpresa(companyId, true);
  const inicio = cfg.campaignStartAt || new Date();
  return sequelize.query<{ id: number; name: string; number: string; ultima: Date }>(
    `SELECT c.id, c.name, c.number, MAX(m."createdAt") AS ultima
       FROM "Contacts" c
       JOIN "Messages" m ON m."contactId" = c.id AND m."companyId" = c."companyId"
      WHERE c."companyId" = :companyId AND c."isGroup" = false AND c."isPersonal" = false
        AND m."createdAt" < :inicio
        AND NOT EXISTS (SELECT 1 FROM "CampaignListMembers" l WHERE l."companyId" = c."companyId" AND l.number = regexp_replace(c.number, '\\D', '', 'g'))
        AND NOT EXISTS (
          SELECT 1 FROM "Tickets" t JOIN "TicketTags" tt ON tt."ticketId" = t.id JOIN "Tags" g ON g.id = tt."tagId"
           WHERE t."contactId" = c.id AND g.name ILIKE '%disparo%')
        AND NOT EXISTS (SELECT 1 FROM "Tickets" t2 WHERE t2."contactId" = c.id AND t2."salesSource" = 'elo_eventos')
      GROUP BY c.id, c.name, c.number
      ORDER BY MAX(m."createdAt") DESC`,
    { replacements: { companyId, inicio }, type: QueryTypes.SELECT }
  );
}

export const personalSuggestions = async (req: Request, res: Response): Promise<Response> => {
  const lista = await sugestaoDePessoais(req.user.companyId);
  return res.json({ total: lista.length, contatos: lista });
};

export const applyPersonalSuggestions = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const lista = await sugestaoDePessoais(companyId);
  const excluir = new Set<number>((Array.isArray(req.body?.excluirIds) ? req.body.excluirIds : []).map(Number));
  const ids = lista.map(c => c.id).filter(id => !excluir.has(id));
  if (!ids.length) return res.json({ afetados: 0 });
  const [afetados] = await Contact.update({ isPersonal: true } as any, { where: { companyId, id: ids } });
  return res.json({ afetados });
};

// ── Listas de campanha ──────────────────────────────────────────────────────

export const importCampaignList = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const nome = String(req.body?.listName || "").trim().slice(0, 160);
  if (!nome) throw new AppError("Dê um nome à lista.", 400);
  const codigo = req.body?.campaignRef ? String(req.body.campaignRef).toUpperCase() : null;
  const enviadoEm = req.body?.sentAt ? new Date(req.body.sentAt) : null;
  const numeros: string[] = Array.from(new Set<string>((Array.isArray(req.body?.numeros) ? req.body.numeros : []).map(normalizarTelefone).filter((n: string) => n.length >= 12)));
  if (!numeros.length) throw new AppError("Nenhum telefone válido na lista.", 400);
  let criados = 0;
  for (const number of numeros) {
    // eslint-disable-next-line no-await-in-loop
    const [m, novo] = await CampaignListMember.findOrCreate({
      where: { companyId, number, listName: nome },
      defaults: { companyId, number, listName: nome, campaignRef: codigo, lastCampaignMessageAt: enviadoEm } as any
    });
    if (novo) criados++;
    // eslint-disable-next-line no-await-in-loop
    else if (enviadoEm || codigo) await m.update({ ...(enviadoEm ? { lastCampaignMessageAt: enviadoEm } : {}), ...(codigo ? { campaignRef: codigo } : {}) } as any);
  }
  return res.json({ lista: nome, recebidos: numeros.length, criados });
};

/** Traz para as listas de campanha quem passou pelas listas de disparo do funil (data = última mensagem automática). */
export const importFromTags = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const tagIds: number[] = (Array.isArray(req.body?.tagIds) ? req.body.tagIds : []).map(Number).filter(Number.isFinite);
  if (!tagIds.length) throw new AppError("Escolha as listas.", 400);
  const codigo = String(req.body?.campaignRef || "ELO-WA").toUpperCase();
  const linhas = await sequelize.query<{ number: string; lista: string; enviado: Date | null }>(
    `SELECT c.number, g.name AS lista,
            (SELECT MAX(r."sentAt") FROM "TagAutomationRuns" r WHERE r."ticketId" = t.id AND r."sentAt" IS NOT NULL) AS enviado
       FROM "TicketTags" tt JOIN "Tags" g ON g.id = tt."tagId" JOIN "Tickets" t ON t.id = tt."ticketId" JOIN "Contacts" c ON c.id = t."contactId"
      WHERE g."companyId" = :companyId AND g.id IN (:tagIds) AND c."isGroup" = false`,
    { replacements: { companyId, tagIds }, type: QueryTypes.SELECT }
  );
  let criados = 0;
  for (const l of linhas) {
    const number = normalizarTelefone(l.number);
    if (number.length < 12) continue;
    // eslint-disable-next-line no-await-in-loop
    const [m, novo] = await CampaignListMember.findOrCreate({
      where: { companyId, number, listName: l.lista },
      defaults: { companyId, number, listName: l.lista, campaignRef: codigo, lastCampaignMessageAt: l.enviado } as any
    });
    if (novo) criados++;
    // eslint-disable-next-line no-await-in-loop
    else if (l.enviado) await m.update({ lastCampaignMessageAt: l.enviado } as any);
  }
  return res.json({ encontrados: linhas.length, criados });
};

export const listCampaignLists = async (req: Request, res: Response): Promise<Response> => {
  const linhas = await sequelize.query(
    `SELECT "listName", "campaignRef", COUNT(*)::int AS contatos, MAX("lastCampaignMessageAt") AS ultimo
       FROM "CampaignListMembers" WHERE "companyId" = :c GROUP BY "listName", "campaignRef" ORDER BY MAX("lastCampaignMessageAt") DESC NULLS LAST`,
    { replacements: { c: req.user.companyId }, type: QueryTypes.SELECT }
  );
  return res.json(linhas);
};

// ── Playbook ────────────────────────────────────────────────────────────────

export const listPlaybook = async (req: Request, res: Response): Promise<Response> => {
  const versoes = await SalesPlaybookVersion.findAll({ where: { companyId: req.user.companyId }, order: [["version", "DESC"]], limit: 50 });
  return res.json(versoes);
};

export const savePlaybook = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const content = String(req.body?.content || "");
  if (!content.trim()) throw new AppError("O texto da playbook está vazio.", 400);
  if (content.length > 60000) throw new AppError("A playbook passou de 60 mil caracteres.", 400);
  const ultima = (await SalesPlaybookVersion.max("version", { where: { companyId } })) as number | null;
  await SalesPlaybookVersion.update({ active: false } as any, { where: { companyId } });
  const nova = await SalesPlaybookVersion.create({
    companyId,
    version: (ultima || 0) + 1,
    content,
    note: req.body?.note ? String(req.body.note).slice(0, 240) : null,
    author: req.body?.author ? String(req.body.author).slice(0, 160) : null,
    active: true
  } as any);
  return res.status(201).json(nova);
};

export const activatePlaybook = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const v = await SalesPlaybookVersion.findOne({ where: { id: Number(req.params.id), companyId } });
  if (!v) throw new AppError("Versão não encontrada.", 404);
  await SalesPlaybookVersion.update({ active: false } as any, { where: { companyId } });
  await v.update({ active: true } as any);
  return res.json(v);
};

// ── Log de decisões ─────────────────────────────────────────────────────────

export const listDecisions = async (req: Request, res: Response): Promise<Response> => {
  const where: any = { companyId: req.user.companyId };
  if (req.query.ticketId) where.ticketId = Number(req.query.ticketId);
  if (req.query.reason) where.reason = String(req.query.reason);
  if (req.query.reply === "1") where.reply = true;
  if (req.query.reply === "0") where.reply = false;
  const limit = Math.min(500, Number(req.query.limit) || 100);
  const linhas = await AiDecisionLog.findAll({ where, order: [["createdAt", "DESC"]], limit });
  const ticketIds = Array.from(new Set(linhas.map(l => l.ticketId).filter(Boolean))) as number[];
  const tickets = ticketIds.length
    ? await Ticket.findAll({ where: { id: ticketIds }, attributes: ["id", "contactId"], include: [{ model: Contact, as: "contact", attributes: ["name", "number", "isPersonal"] }] })
    : [];
  const motivos = await sequelize.query(
    `SELECT reason, COUNT(*)::int AS total FROM "AiDecisionLogs" WHERE "companyId" = :c AND "createdAt" > now() - interval '30 days' GROUP BY reason ORDER BY total DESC`,
    { replacements: { c: req.user.companyId }, type: QueryTypes.SELECT }
  );
  return res.json({
    motivos,
    decisoes: linhas.map(l => {
      const t = tickets.find(x => x.id === l.ticketId) as any;
      const pessoal = !!t?.contact?.isPersonal;
      // Contato pessoal: sem nome nem número no log (só o motivo).
      return { ...l.toJSON(), contato: t?.contact && !pessoal ? { name: t.contact.name, number: t.contact.number } : pessoal ? { name: "contato pessoal" } : null };
    })
  });
};

// ── Ações na conversa (botões do card) ──────────────────────────────────────

export const ticketCommand = async (req: Request, res: Response): Promise<Response> => {
  const ticket = await Ticket.findOne({ where: { id: Number(req.params.ticketId), companyId: req.user.companyId } });
  if (!ticket) throw new AppError("Conversa não encontrada.", 404);
  const comando = lerComandoVal(`#val ${String(req.body?.comando || "")}`);
  if (!comando) throw new AppError("Comando inválido.", 400);
  const resultado = await aplicarComandoVal(ticket, comando, `painel:${req.user.id}`);
  await ticket.reload();
  return res.json({ resultado, aiPausedUntil: ticket.aiPausedUntil, salesSource: ticket.salesSource, salesStage: ticket.salesStage });
};

// ── Painel de leads ─────────────────────────────────────────────────────────

export const dashboard = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const de = req.query.de ? new Date(String(req.query.de)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const ate = req.query.ate ? new Date(String(req.query.ate)) : new Date();
  const porCodigo = await sequelize.query<{ campaignRef: string; via: string; leads: number; qualificados: number; demos: number; testes: number; sem_interesse: number; transferidos: number }>(
    `SELECT COALESCE("campaignRef", '—') AS "campaignRef", COALESCE("salesSourceVia", '—') AS via, COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE "salesStage" = 'qualificado')::int AS qualificados,
            COUNT(*) FILTER (WHERE "salesStage" = 'demo_solicitada')::int AS demos,
            COUNT(*) FILTER (WHERE "salesStage" = 'teste_solicitado')::int AS testes,
            COUNT(*) FILTER (WHERE "salesStage" = 'sem_interesse')::int AS sem_interesse,
            COUNT(*) FILTER (WHERE "salesStage" = 'transferido')::int AS transferidos
       FROM "Tickets" WHERE "companyId" = :c AND "salesSource" = 'elo_eventos' AND "attributedAt" BETWEEN :de AND :ate
      GROUP BY 1, 2 ORDER BY leads DESC`,
    { replacements: { c: companyId, de, ate }, type: QueryTypes.SELECT }
  );
  const refs = await CampaignRef.findAll({ where: { companyId }, attributes: ["code", "campaignName", "channel"] });
  const ativas = await Ticket.count({
    where: { companyId, salesSource: "elo_eventos", status: { [Op.in]: ["open", "pending"] }, lastClientMessageAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } } as any
  });
  const recentes = await Ticket.findAll({
    where: { companyId, salesSource: "elo_eventos" } as any,
    attributes: ["id", "campaignRef", "salesSourceVia", "salesStage", "salesSummary", "attributedAt", "aiPausedUntil", "status"],
    include: [{ model: Contact, as: "contact", attributes: ["name", "number"] }],
    order: [["attributedAt", "DESC"]],
    limit: 50
  });
  return res.json({
    periodo: { de, ate },
    etapas: ETAPAS_DE_VENDAS,
    conversasAtivas24h: ativas,
    porCodigo: porCodigo.map(l => ({
      ...l,
      campanha: refs.find(r => r.code === l.campaignRef)?.campaignName || l.campaignRef,
      canal: refs.find(r => r.code === l.campaignRef)?.channel || null,
      conversao: l.leads ? Math.round(((l.demos + l.testes) / l.leads) * 1000) / 10 : 0
    })),
    recentes
  });
};

// ── Inventário de automações do CRM ─────────────────────────────────────────

export const automations = async (req: Request, res: Response): Promise<Response> => {
  const { companyId } = req.user;
  const settings = await Setting.findAll({ where: { companyId, key: SETTINGS_DE_ESTADO } });
  const valorDe = (k: string) => settings.find(s => s.key === k)?.value ?? null;
  const acoes = await FunnelAction.findAll({ where: { companyId }, include: [{ model: Tag, as: "tag", attributes: ["id", "name"] }], order: [["id", "ASC"]] });
  const ultimas: Array<{ actionId: number; ultima: Date; enviadas: number; falhas: number }> = acoes.length
    ? await sequelize.query(
        `SELECT "actionId", MAX(COALESCE("sentAt", "updatedAt")) AS ultima,
                COUNT(*) FILTER (WHERE "sentAt" IS NOT NULL)::int AS enviadas,
                COUNT(*) FILTER (WHERE "skippedReason" IS NOT NULL)::int AS falhas
           FROM "TagAutomationRuns" WHERE "actionId" IN (:ids) GROUP BY "actionId"`,
        { replacements: { ids: acoes.map(a => a.id) }, type: QueryTypes.SELECT }
      )
    : [];
  const cfg = await SalesAiConfig.findOne({ where: { companyId } });
  const ultimaDecisao = await AiDecisionLog.max("createdAt", { where: { companyId } });
  return res.json({
    valVendas: {
      ligada: !!cfg?.enabled && chaveDoAmbiente(),
      chaveDoPainel: !!cfg?.enabled,
      chaveDoAmbiente: chaveDoAmbiente(),
      conexoes: cfg?.whatsappIds || [],
      ultimaDecisao
    },
    catalogo: CATALOGO_DO_CRM.map(i => {
      let estado: string | null = null;
      if (i.chaveDeEstado?.startsWith("setting:")) estado = valorDe(i.chaveDeEstado.slice(8));
      return { ...i, estado };
    }),
    settings: SETTINGS_DE_ESTADO.map(k => ({ chave: k, valor: valorDe(k) })),
    acoesDoFunil: acoes.map(a => {
      const u = ultimas.find(x => Number(x.actionId) === a.id);
      return {
        id: a.id,
        lista: (a as any).tag?.name || (a.tagId ? `lista ${a.tagId}` : "Entrada (conversa nova)"),
        tipo: a.tipo,
        ativo: a.ativo,
        atrasoMinutos: a.atrasoMinutos,
        umaVezSo: a.umaVezSo,
        soHorarioComercial: a.soHorarioComercial,
        valVendas: !!(a.config as any)?.soSemResposta,
        ultimaExecucao: u?.ultima || null,
        enviadas: u?.enviadas || 0,
        falhasOuPuladas: u?.falhas || 0
      };
    })
  });
};

export const runsSummary = async (req: Request, res: Response): Promise<Response> => {
  const total = await TagAutomationRun.count({ where: { companyId: req.user.companyId } as any });
  return res.json({ total });
};
