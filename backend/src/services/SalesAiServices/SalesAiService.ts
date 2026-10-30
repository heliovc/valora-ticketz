import { Op } from "sequelize";
import { resultadoDaEtapaDeVendas } from "../../helpers/encerramento";
import { encerrarPelaIa } from "../AiBotServices/EncerrarPelaIa";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Tag from "../../models/Tag";
import Ticket from "../../models/Ticket";
import TicketTag from "../../models/TicketTag";
import {
  AiDecisionLog,
  CampaignListMember,
  CampaignRef,
  SalesAiConfig,
  SalesPlaybookVersion
} from "../../models/SalesAi";
import { notificarValoraPorEmail } from "../TagServices/notificarValora";
import { logger } from "../../utils/logger";
import {
  CODIGOS_PADRAO,
  CONFIG_PADRAO,
  ComandoVal,
  DecisaoDaIa,
  HorarioDeFuncionamento,
  ViaDeOrigem,
  codigoNasPrimeiras,
  dentroDoHorario,
  extrairMarcadoresDeVendas,
  normalizarTelefone,
  regrasCompletas,
  removerCodigo,
  shouldAiReply,
  textoPadraoDoCodigo
} from "./salesAiRules";

/**
 * Val Vendas — o motor. As regras vêm de `SalesAiConfigs` (painel da Valora),
 * lidas a cada mensagem: mudar na tela muda o comportamento na hora.
 *
 * Escopo: só as conexões listadas na configuração da empresa. Fora delas o CRM
 * segue exatamente como antes. Dentro delas a IA antiga (aiBotEnabled) não
 * responde mais: quem decide é `shouldAiReply`.
 */

export const ORIGEM_ELO = "elo_eventos";

// ── Configuração ────────────────────────────────────────────────────────────

export async function configDaEmpresa(companyId: number, criar = false): Promise<SalesAiConfig | null> {
  const existente = await SalesAiConfig.findOne({ where: { companyId } });
  if (existente || !criar) return existente;
  const nova = await SalesAiConfig.create({
    companyId,
    enabled: false,
    whatsappIds: [],
    campaignStartAt: null,
    listWindowDays: CONFIG_PADRAO.listWindowDays,
    refCodeScanMessages: CONFIG_PADRAO.refCodeScanMessages,
    humanPauseMinutes: CONFIG_PADRAO.humanPauseMinutes,
    valCommandsEnabled: CONFIG_PADRAO.valCommandsEnabled,
    maxAiMessagesPerConversation: CONFIG_PADRAO.maxAiMessagesPerConversation,
    maxAiMessagesPerMinute: CONFIG_PADRAO.maxAiMessagesPerMinute,
    rules: regrasCompletas({}),
    businessHours: CONFIG_PADRAO.businessHours,
    handoff: CONFIG_PADRAO.handoff,
    prospecting: CONFIG_PADRAO.prospecting,
    protocol: CONFIG_PADRAO.protocol
  } as any);
  for (const c of CODIGOS_PADRAO) {
    // eslint-disable-next-line no-await-in-loop
    await CampaignRef.findOrCreate({
      where: { companyId, code: c.code },
      defaults: { companyId, ...c, prefilledText: textoPadraoDoCodigo(c.code) } as any
    });
  }
  return nova;
}

export function chaveDoAmbiente(): boolean {
  return String(process.env.ELO_SALES_AI_ENABLED || "").toLowerCase() === "true";
}

/** A conversa está numa conexão da Val Vendas? Devolve a configuração. */
export async function escopoDeVendas(ticket: Pick<Ticket, "companyId" | "whatsappId">): Promise<SalesAiConfig | null> {
  if (!ticket?.whatsappId) return null;
  const cfg = await configDaEmpresa(ticket.companyId);
  if (!cfg) return null;
  const ids = Array.isArray(cfg.whatsappIds) ? cfg.whatsappIds.map(Number) : [];
  return ids.includes(Number(ticket.whatsappId)) ? cfg : null;
}

async function playbookAtiva(companyId: number): Promise<SalesPlaybookVersion | null> {
  return SalesPlaybookVersion.findOne({ where: { companyId, active: true }, order: [["version", "DESC"]] });
}

/** Persona da Val Vendas: a playbook ativa + o protocolo de marcadores. */
export async function promptDeVendas(cfg: SalesAiConfig): Promise<string> {
  const pb = await playbookAtiva(cfg.companyId);
  return [pb?.content?.trim() || "", (cfg.protocol || "").trim()].filter(Boolean).join("\n\n");
}

// ── Atribuição de origem ────────────────────────────────────────────────────

async function marcarOrigem(
  ticket: Ticket,
  via: ViaDeOrigem,
  codigo: string | null
): Promise<void> {
  await ticket.update({
    salesSource: ORIGEM_ELO,
    salesSourceVia: via,
    campaignRef: codigo,
    attributedAt: new Date(),
    salesStage: ticket.salesStage || "novo"
  } as any);
  logger.info(`[val-vendas] ticket ${ticket.id} atribuído: ${via} ${codigo || ""}`);
}

/**
 * Reconhece se a conversa veio do Elo Eventos. Ordem: conversa anterior do
 * mesmo contato já atribuída → código nas primeiras mensagens → anúncio
 * (referral da Meta) → lista de campanha dentro da janela. Tira o código do
 * texto guardado (o original fica em `bodyOriginal`).
 */
export async function atribuirOrigem(ticket: Ticket, contact: Contact, cfg: SalesAiConfig): Promise<void> {
  if (ticket.salesSource) {
    await limparCodigoDasMensagens(ticket, cfg);
    return;
  }

  const anterior = await Ticket.findOne({
    where: { companyId: ticket.companyId, contactId: contact.id, salesSource: ORIGEM_ELO, id: { [Op.ne]: ticket.id } },
    order: [["attributedAt", "DESC"]]
  });
  if (anterior) {
    await ticket.update({
      salesSource: ORIGEM_ELO,
      salesSourceVia: anterior.salesSourceVia,
      campaignRef: anterior.campaignRef,
      attributedAt: anterior.attributedAt,
      salesStage: anterior.salesStage === "transferido" ? "transferido" : anterior.salesStage || "novo",
      salesSummary: anterior.salesSummary
    } as any);
    return;
  }

  const primeiras = await Message.findAll({
    where: { ticketId: ticket.id, fromMe: false },
    order: [["createdAt", "ASC"]],
    limit: Math.max(1, cfg.refCodeScanMessages)
  });
  const achado = codigoNasPrimeiras(primeiras.map(m => m.bodyOriginal || m.body || ""), cfg.refCodeScanMessages);
  if (achado) {
    const ref = await CampaignRef.findOne({ where: { companyId: ticket.companyId, code: achado.codigo } });
    if (ref?.active) {
      await marcarOrigem(ticket, "codigo", ref.code);
      await limparCodigoDasMensagens(ticket, cfg);
      return;
    }
    logger.info(`[val-vendas] ticket ${ticket.id}: código ${achado.codigo} ${ref ? "inativo" : "desconhecido"} — não atribuído`);
  }

  if (ticket.referralSourceId) {
    const especifico = await CampaignRef.findOne({ where: { companyId: ticket.companyId, code: `ELO-ADS-${ticket.referralSourceId}`.toUpperCase(), active: true } });
    const geral = especifico || (await CampaignRef.findOne({ where: { companyId: ticket.companyId, code: "ELO-ADS", active: true } }));
    if (geral) {
      await marcarOrigem(ticket, "anuncio", geral.code);
      return;
    }
  }

  const numero = normalizarTelefone(contact.number);
  if (numero) {
    const desde = new Date(Date.now() - Math.max(0, cfg.listWindowDays) * 24 * 60 * 60 * 1000);
    const membro = await CampaignListMember.findOne({
      where: { companyId: ticket.companyId, number: numero, lastCampaignMessageAt: { [Op.gte]: desde } },
      order: [["lastCampaignMessageAt", "DESC"]]
    });
    if (membro) await marcarOrigem(ticket, "lista", membro.campaignRef || String((cfg.prospecting as any)?.codigo || "") || null);
  }
}

/** Tira `[ELO-…]` das mensagens do cliente já gravadas (tela e IA veem o texto limpo). */
async function limparCodigoDasMensagens(ticket: Ticket, cfg: SalesAiConfig): Promise<void> {
  const msgs = await Message.findAll({
    where: { ticketId: ticket.id, fromMe: false, body: { [Op.iLike]: "%[%ELO-%]%" } },
    limit: Math.max(1, cfg.refCodeScanMessages) + 2
  });
  for (const m of msgs) {
    const limpo = removerCodigo(m.body);
    if (limpo !== m.body) {
      // eslint-disable-next-line no-await-in-loop
      await m.update({ bodyOriginal: m.bodyOriginal || m.body, body: limpo || "…" } as any);
    }
  }
  if (ticket.lastMessage && /\[\s*ELO-/i.test(ticket.lastMessage)) {
    await ticket.update({ lastMessage: removerCodigo(ticket.lastMessage) } as any, { silent: true } as any);
  }
}

// ── Decisão ─────────────────────────────────────────────────────────────────

export interface ContextoDaMensagem {
  ehGrupo?: boolean;
  ehTransmissaoOuStatus?: boolean;
  messageId?: string | null;
}

export async function contarIa(ticketId: number, companyId: number): Promise<{ naConversa: number; noUltimoMinuto: number }> {
  const [naConversa, noUltimoMinuto] = await Promise.all([
    Message.count({ where: { ticketId, fromMe: true, sentBy: "ai" } as any }),
    Message.count({ where: { companyId, fromMe: true, sentBy: "ai", createdAt: { [Op.gte]: new Date(Date.now() - 60 * 1000) } } as any })
  ]);
  return { naConversa, noUltimoMinuto };
}

export async function decidir(
  ticket: Ticket,
  contact: Contact,
  cfg: SalesAiConfig,
  ctx: ContextoDaMensagem = {}
): Promise<DecisaoDaIa> {
  const [contagem, pb] = await Promise.all([contarIa(ticket.id, ticket.companyId), playbookAtiva(ticket.companyId)]);
  return shouldAiReply({
    chaveDoAmbiente: chaveDoAmbiente(),
    chaveDoPainel: !!cfg.enabled,
    regras: regrasCompletas(cfg.rules),
    temPlaybook: !!pb?.content?.trim(),
    conversa: {
      salesSource: ticket.salesSource,
      salesSourceVia: ticket.salesSourceVia,
      salesStage: ticket.salesStage,
      aiPausedUntil: ticket.aiPausedUntil ? new Date(ticket.aiPausedUntil) : null,
      temAtendente: !!ticket.userId
    },
    contato: { isPersonal: !!contact.isPersonal },
    mensagem: { ehGrupo: !!(ctx.ehGrupo || ticket.isGroup || contact.isGroup), ehTransmissaoOuStatus: !!ctx.ehTransmissaoOuStatus },
    contadores: {
      iaNaConversa: contagem.naConversa,
      iaNoUltimoMinuto: contagem.noUltimoMinuto,
      maxPorConversa: cfg.maxAiMessagesPerConversation,
      maxPorMinuto: cfg.maxAiMessagesPerMinute
    },
    dentroDoHorario: dentroDoHorario(cfg.businessHours as HorarioDeFuncionamento, new Date()),
    agora: new Date()
  });
}

/** Grava a decisão. Nunca grava o conteúdo da mensagem (contato pessoal incluído). */
export async function registrarDecisao(
  ticket: Ticket,
  contact: Contact,
  decisao: DecisaoDaIa,
  ctx: ContextoDaMensagem = {}
): Promise<void> {
  try {
    await AiDecisionLog.create({
      companyId: ticket.companyId,
      ticketId: ticket.id,
      contactId: contact.id,
      messageId: ctx.messageId || null,
      whatsappId: ticket.whatsappId,
      reply: decisao.reply,
      reason: decisao.reason,
      details: {
        origem: ticket.salesSource,
        via: ticket.salesSourceVia,
        codigo: ticket.campaignRef,
        etapa: ticket.salesStage,
        pessoal: !!contact.isPersonal
      }
    } as any);
  } catch (err: any) {
    logger.error({ err: err?.message }, "[val-vendas] log de decisão falhou");
  }
  logger.info(`[val-vendas] ticket ${ticket.id}: ${decisao.reply ? "responde" : "não responde"} (${decisao.reason})`);
}

/**
 * Ponto de entrada das três portas (QR, Oficial, chat do site), na mensagem do
 * cliente: atribui, decide e registra. `null` = conversa fora da Val Vendas
 * (o fluxo antigo segue como sempre).
 */
export async function avaliarMensagemRecebida(
  ticket: Ticket,
  contact: Contact,
  ctx: ContextoDaMensagem = {}
): Promise<DecisaoDaIa | null> {
  const cfg = await escopoDeVendas(ticket);
  if (!cfg) return null;
  if (!contact.isPersonal) await atribuirOrigem(ticket, contact, cfg);
  await ticket.reload();
  const decisao = await decidir(ticket, contact, cfg, ctx);
  await registrarDecisao(ticket, contact, decisao, ctx);
  return decisao;
}

// ── Depois da resposta da IA ────────────────────────────────────────────────

/**
 * Limpa os marcadores, grava etapa e resumo. Transferência (pedida pela
 * playbook ou por handoff) para a IA e avisa o Hélio. Falha de todos os
 * provedores pausa a conversa e avisa — em vez de repetir "Só um momento…".
 */
export async function aplicarResposta(
  ticket: Ticket,
  contact: Contact,
  cfg: SalesAiConfig,
  texto: string,
  sinais: { handoff: boolean; falha: boolean }
): Promise<string> {
  if (sinais.falha) {
    await ticket.update({ aiPausedUntil: new Date(Date.now() + cfg.humanPauseMinutes * 60 * 1000) } as any);
    await avisarTransferencia(ticket, contact, cfg, "A IA falhou ao responder (provedores indisponíveis). A conversa ficou pausada para você.");
    return "";
  }
  const m = extrairMarcadoresDeVendas(texto);
  const etapaAnterior = ticket.salesStage;
  const mudancas: Record<string, unknown> = {};
  if (m.etapa) mudancas.salesStage = m.etapa;
  if (m.resumo) mudancas.salesSummary = m.resumo.slice(0, 300);
  if (m.transferir || sinais.handoff) {
    // Demo ou teste aceitos também transferem (playbook, seção 8): a etapa
    // continua contando no painel e a IA para pela pausa sem prazo.
    const pedida = m.etapaPedida;
    mudancas.salesStage = pedida === "demo_solicitada" || pedida === "teste_solicitado" ? pedida : "transferido";
    mudancas.aiPausedUntil = new Date("2100-01-01T00:00:00Z");
  }
  if (Object.keys(mudancas).length) await ticket.update(mudancas as any);
  if (m.transferir || sinais.handoff) {
    await avisarTransferencia(ticket, contact, cfg, m.resumo || ticket.salesSummary || "A playbook pediu transferência.");
  }
  // Sem interesse = perdido; demo ou teste aceitos = fechado. Dispara o gatilho
  // do resultado em Automações (mover para "Perdido", desligar a Val...).
  const fim = resultadoDaEtapaDeVendas(etapaAnterior, mudancas.salesStage as string | undefined);
  if (fim) await encerrarPelaIa(ticket.id, ticket.companyId, fim, m.resumo || undefined);
  return m.texto;
}

export async function avisarTransferencia(ticket: Ticket, contact: Contact, cfg: SalesAiConfig, observacao: string): Promise<void> {
  const h = (cfg.handoff || {}) as { email?: string | null; etiqueta?: string | null; avisarNoCrm?: boolean };
  try {
    if (h.avisarNoCrm !== false && h.etiqueta) {
      const [tag] = await Tag.findOrCreate({
        where: { companyId: ticket.companyId, name: h.etiqueta, kanban: 0 },
        defaults: { companyId: ticket.companyId, name: h.etiqueta, color: "#f59e0b", kanban: 0 } as any
      });
      await TicketTag.findOrCreate({ where: { ticketId: ticket.id, tagId: tag.id }, defaults: { ticketId: ticket.id, tagId: tag.id } as any });
      await ticket.update({ unreadMessages: Math.max(1, ticket.unreadMessages || 0) } as any);
    }
    const empresa = await Company.findByPk(ticket.companyId);
    if (empresa?.externalId) {
      await notificarValoraPorEmail({
        tenantId: empresa.externalId,
        para: h.email || null,
        ticketId: ticket.id,
        contatoNome: contact.name || "",
        contatoNumero: contact.number || "",
        gatilho: "Val Vendas: lead transferido para você",
        observacao
      } as any);
    }
  } catch (err: any) {
    logger.error({ err: err?.message, ticketId: ticket.id }, "[val-vendas] aviso de transferência falhou");
  }
}

// ── Quem enviou cada mensagem nossa ─────────────────────────────────────────

const ORIGEM_FORTE = new Set(["ai", "humano", "automacao"]);
const registro = new Map<string, { origem: string; em: number }>();
const TTL_REGISTRO_MS = 10 * 60 * 1000;

/** Marca o id de uma mensagem que nós enviamos. Origem específica vence "sistema". */
export function registrarEnvio(id: string | null | undefined, origem: string): void {
  if (!id) return;
  const atual = registro.get(id);
  if (atual && ORIGEM_FORTE.has(atual.origem) && !ORIGEM_FORTE.has(origem)) return;
  registro.set(id, { origem, em: Date.now() });
  if (registro.size > 5000) {
    const limite = Date.now() - TTL_REGISTRO_MS;
    for (const [k, v] of registro) if (v.em < limite) registro.delete(k);
  }
}

export function origemRegistrada(id: string): string | null {
  return registro.get(id)?.origem || null;
}

/**
 * Toda mensagem nossa passa aqui (CreateMessageService): grava quem enviou
 * (`ai` conta para os limites). Mensagem marcada como humana pausa a IA.
 *
 * O QR roda com `emitOwnEvents: false`: o que o próprio CRM envia NÃO volta
 * pelo listener. O que chega lá como "enviado por mim" veio de outro aparelho
 * — o celular do Hélio — e é tratado em `wbotMessageListener` como humano.
 */
export function aoGravarMensagemNossa(message: Message, sentByInformado?: string | null): void {
  if (!message?.fromMe) return;
  const origem = sentByInformado || origemRegistrada(message.id);
  if (!origem || message.sentBy === origem) return;
  Message.update({ sentBy: origem } as any, { where: { id: message.id, ticketId: message.ticketId } }).catch(() => undefined);
}

/** Humano respondeu (painel ou celular): pausa a IA pelo tempo do painel. */
export async function pausarPorHumano(ticketId: number): Promise<void> {
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket?.salesSource) return;
  const cfg = await escopoDeVendas(ticket);
  if (!cfg || !regrasCompletas(cfg.rules).respeitarPausaHumana) return;
  const ate = new Date(Date.now() + Math.max(0, cfg.humanPauseMinutes) * 60 * 1000);
  const atual = ticket.aiPausedUntil ? new Date(ticket.aiPausedUntil) : null;
  if (atual && atual > ate) return; // #val off ou pausa maior continua valendo
  await ticket.update({ aiPausedUntil: ate } as any);
  logger.info(`[val-vendas] ticket ${ticketId}: humano respondeu, IA pausada até ${ate.toISOString()}`);
  await AiDecisionLog.create({
    companyId: ticket.companyId,
    ticketId,
    contactId: ticket.contactId,
    whatsappId: ticket.whatsappId,
    reply: false,
    reason: "humano_respondeu_pausa",
    details: { ate: ate.toISOString() }
  } as any).catch(() => undefined);
}

// ── Comandos #val ───────────────────────────────────────────────────────────

const PARA_SEMPRE = new Date("2100-01-01T00:00:00Z");

/** Ligar a Val Vendas numa conversa: tira a pausa e, se preciso, a marca como lead. */
function mudancasParaLigar(ticket: Ticket): Record<string, unknown> {
  const mudancas: Record<string, unknown> = { aiPausedUntil: null };
  if (!ticket.salesSource) {
    Object.assign(mudancas, { salesSource: ORIGEM_ELO, salesSourceVia: "manual", campaignRef: "MANUAL", attributedAt: new Date(), salesStage: "novo" });
  } else if (ticket.salesStage === "transferido") {
    mudancas.salesStage = "qualificado";
  }
  return mudancas;
}

/**
 * Liga ou desliga a Val Vendas NESTA conversa, pelo funil ou pelo card. Ao
 * contrário do #val, não depende de `valCommandsEnabled`: aquela chave é sobre
 * comandos digitados no WhatsApp, não sobre o painel. Fora de um número da Val
 * Vendas não faz nada e devolve false.
 */
export async function ligarValNaConversa(ticket: Ticket, ligado: boolean, porQuem: string): Promise<boolean> {
  if (!(await escopoDeVendas(ticket))) return false;
  await ticket.update((ligado ? mudancasParaLigar(ticket) : { aiPausedUntil: PARA_SEMPRE }) as any);
  await AiDecisionLog.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    contactId: ticket.contactId,
    whatsappId: ticket.whatsappId,
    reply: false,
    reason: ligado ? "val_ligada" : "val_desligada",
    details: { porQuem }
  } as any).catch(() => undefined);
  logger.info(`[val-vendas] ticket ${ticket.id}: ${ligado ? "ligada" : "desligada"} (${porQuem})`);
  return true;
}

export async function aplicarComandoVal(ticket: Ticket, comando: ComandoVal, porQuem: string): Promise<string> {
  const cfg = await escopoDeVendas(ticket);
  if (!cfg) return "Esta conversa não está numa conexão da Val Vendas.";
  if (!cfg.valCommandsEnabled) return "Os comandos #val estão desligados no painel.";
  if (comando.acao === "invalido") return "Comando não reconhecido. Use #val on, #val off ou #val pausa 2h.";
  if (comando.acao === "off") {
    await ticket.update({ aiPausedUntil: PARA_SEMPRE } as any);
  } else if (comando.acao === "pausa") {
    await ticket.update({ aiPausedUntil: new Date(Date.now() + comando.minutos * 60 * 1000) } as any);
  } else {
    await ticket.update(mudancasParaLigar(ticket) as any);
  }
  await AiDecisionLog.create({
    companyId: ticket.companyId,
    ticketId: ticket.id,
    contactId: ticket.contactId,
    whatsappId: ticket.whatsappId,
    reply: false,
    reason: `comando_val_${comando.acao}`,
    details: { porQuem, ...(comando.acao === "pausa" ? { minutos: comando.minutos } : {}) }
  } as any).catch(() => undefined);
  logger.info(`[val-vendas] ticket ${ticket.id}: #val ${comando.acao} (${porQuem})`);
  return comando.acao === "on" ? "IA ligada nesta conversa." : comando.acao === "off" ? "IA desligada nesta conversa." : "IA pausada nesta conversa.";
}

// ── Prospecção (ELO-WA) ─────────────────────────────────────────────────────

/** Mensagem de campanha enviada pela ferramenta numa lista de prospecção do painel. */
export async function registrarEnvioDeCampanha(
  companyId: number,
  numero: string,
  tagId: number | null,
  nomeDaLista: string
): Promise<void> {
  const cfg = await configDaEmpresa(companyId);
  if (!cfg) return;
  const p = (cfg.prospecting || {}) as { tagIds?: number[]; codigo?: string };
  if (!tagId || !Array.isArray(p.tagIds) || !p.tagIds.map(Number).includes(Number(tagId))) return;
  const n = normalizarTelefone(numero);
  if (!n) return;
  const [membro] = await CampaignListMember.findOrCreate({
    where: { companyId, number: n, listName: nomeDaLista },
    defaults: { companyId, number: n, listName: nomeDaLista, campaignRef: p.codigo || null, lastCampaignMessageAt: new Date() } as any
  });
  await membro.update({ lastCampaignMessageAt: new Date(), campaignRef: p.codigo || membro.campaignRef } as any);
}
