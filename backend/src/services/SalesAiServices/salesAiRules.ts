/**
 * Val Vendas — regras puras (sem banco), para teste.
 *
 * Padrão: IA DESLIGADA. Ela só responde quando todas as condições ligadas no
 * painel são verdadeiras. Os números (janela, pausa, limites) vêm da
 * configuração da empresa; aqui não há valor de negócio fixo além dos
 * defaults usados para criar a configuração na primeira vez.
 */

export const ETAPAS_DE_VENDAS = [
  "novo",
  "qualificado",
  "demo_solicitada",
  "teste_solicitado",
  "sem_interesse",
  "transferido"
] as const;
export type EtapaDeVendas = (typeof ETAPAS_DE_VENDAS)[number];

export type ViaDeOrigem = "codigo" | "formulario" | "lista" | "anuncio" | "manual";

/** Condições de `shouldAiReply` que o painel liga e desliga. */
export interface RegrasDeAtivacao {
  /** Só responde conversa com origem Elo Eventos. Desligar = responde qualquer conversa da conexão. */
  exigirOrigem: boolean;
  origemPorCodigo: boolean;
  origemPorFormulario: boolean;
  origemPorLista: boolean;
  origemPorAnuncio: boolean;
  origemManual: boolean;
  bloquearPessoais: boolean;
  bloquearGrupos: boolean;
  respeitarPausaHumana: boolean;
  respeitarAtendente: boolean;
  pararQuandoTransferido: boolean;
  respeitarHorario: boolean;
  aplicarLimites: boolean;
}

export const REGRAS_PADRAO: RegrasDeAtivacao = {
  exigirOrigem: true,
  origemPorCodigo: true,
  origemPorFormulario: true,
  origemPorLista: true,
  origemPorAnuncio: true,
  origemManual: true,
  bloquearPessoais: true,
  bloquearGrupos: true,
  respeitarPausaHumana: true,
  respeitarAtendente: true,
  pararQuandoTransferido: true,
  respeitarHorario: true,
  aplicarLimites: true
};

export function regrasCompletas(parciais?: Record<string, unknown> | null): RegrasDeAtivacao {
  const r = { ...REGRAS_PADRAO };
  for (const k of Object.keys(REGRAS_PADRAO) as (keyof RegrasDeAtivacao)[]) {
    if (parciais && typeof parciais[k] === "boolean") r[k] = parciais[k] as boolean;
  }
  return r;
}

// ── Códigos de origem ───────────────────────────────────────────────────────

const CODIGO_RE = /\[\s*(ELO-[A-Z0-9-]{2,40})\s*\]/i;
const CODIGO_RE_GLOBAL = /\s*\[\s*ELO-[A-Z0-9-]{2,40}\s*\]\s*/gi;

/** Primeiro código `[ELO-…]` do texto, em maiúsculas. Tolera espaços e minúsculas. */
export function extrairCodigo(texto: string | null | undefined): string | null {
  const m = String(texto || "").match(CODIGO_RE);
  return m ? m[1].toUpperCase().replace(/-+$/, "") : null;
}

/** O texto sem o(s) código(s), com os espaços arrumados. */
export function removerCodigo(texto: string | null | undefined): string {
  return String(texto || "")
    .replace(CODIGO_RE_GLOBAL, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trim();
}

/** Procura o código nas primeiras N mensagens do cliente (a 1ª pode ser só "oi"). */
export function codigoNasPrimeiras(mensagens: string[], n: number): { codigo: string; indice: number } | null {
  const limite = Math.max(1, n);
  for (let i = 0; i < mensagens.length && i < limite; i++) {
    const codigo = extrairCodigo(mensagens[i]);
    if (codigo) return { codigo, indice: i };
  }
  return null;
}

/** Telefone só com dígitos, com DDI 55 quando vier no formato nacional. */
export function normalizarTelefone(bruto: string | null | undefined): string {
  let n = String(bruto || "").replace(/\D/g, "").replace(/^0+/, "");
  if ((n.length === 10 || n.length === 11) && !n.startsWith("55")) n = `55${n}`;
  return n;
}

/** Duração de "#val pausa 2h" → minutos. Aceita 30m, 2h, 1d, "2 horas". */
export function duracaoEmMinutos(texto: string): number | null {
  const m = String(texto || "").trim().toLowerCase().match(/^(\d+)\s*(m|min|minutos?|h|horas?|d|dias?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] || "h")[0];
  if (u === "m") return n;
  if (u === "d") return n * 24 * 60;
  return n * 60;
}

export type ComandoVal =
  | { acao: "on" }
  | { acao: "off" }
  | { acao: "pausa"; minutos: number }
  | { acao: "invalido" };

/** "#val on", "#val off", "#val pausa 2h". `null` = não é comando. */
export function lerComandoVal(texto: string | null | undefined): ComandoVal | null {
  const m = String(texto || "").trim().match(/^#val\b\s*(.*)$/i);
  if (!m) return null;
  const resto = m[1].trim().toLowerCase();
  if (resto === "on" || resto === "ligar") return { acao: "on" };
  if (resto === "off" || resto === "desligar") return { acao: "off" };
  const p = resto.match(/^pausa(?:r)?\s+(.+)$/);
  if (p) {
    const minutos = duracaoEmMinutos(p[1]);
    if (minutos && minutos > 0) return { acao: "pausa", minutos };
  }
  return { acao: "invalido" };
}

// ── Horário ─────────────────────────────────────────────────────────────────

export interface HorarioDeFuncionamento {
  ativo?: boolean;
  /** 0 = domingo … 6 = sábado */
  dias?: number[];
  inicio?: string; // "08:00"
  fim?: string; // "20:00"
}

/** Dentro do horário (America/Sao_Paulo)? Horário desligado = sempre dentro. */
export function dentroDoHorario(h: HorarioDeFuncionamento | null | undefined, agora: Date): boolean {
  if (!h || !h.ativo) return true;
  const sp = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dia = sp.getDay();
  if (Array.isArray(h.dias) && h.dias.length && !h.dias.includes(dia)) return false;
  const minutos = sp.getHours() * 60 + sp.getMinutes();
  const paraMin = (s?: string) => {
    const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const ini = paraMin(h.inicio);
  const fim = paraMin(h.fim);
  if (ini === null || fim === null) return true;
  if (ini <= fim) return minutos >= ini && minutos < fim;
  return minutos >= ini || minutos < fim; // atravessa a meia-noite
}

// ── A decisão ───────────────────────────────────────────────────────────────

export interface EntradaDaDecisao {
  /** Trava de emergência no ambiente (`ELO_SALES_AI_ENABLED`). */
  chaveDoAmbiente: boolean;
  /** Chave do painel. */
  chaveDoPainel: boolean;
  regras: RegrasDeAtivacao;
  temPlaybook: boolean;
  conversa: {
    salesSource: string | null;
    salesSourceVia: string | null;
    salesStage: string | null;
    aiPausedUntil: Date | null;
    /** Atendente aceitou a conversa no CRM. */
    temAtendente: boolean;
  };
  contato: { isPersonal: boolean };
  mensagem: { ehGrupo: boolean; ehTransmissaoOuStatus: boolean };
  contadores: {
    iaNaConversa: number;
    iaNoUltimoMinuto: number;
    maxPorConversa: number;
    maxPorMinuto: number;
  };
  dentroDoHorario: boolean;
  agora: Date;
}

export interface DecisaoDaIa {
  reply: boolean;
  reason: string;
}

const VIA_PARA_REGRA: Record<string, keyof RegrasDeAtivacao> = {
  codigo: "origemPorCodigo",
  formulario: "origemPorFormulario",
  lista: "origemPorLista",
  anuncio: "origemPorAnuncio",
  manual: "origemManual"
};

/**
 * A IA responde esta mensagem? Função pura: tudo que ela precisa vem na
 * entrada. A ordem das checagens define o `reason` registrado no log — a
 * primeira condição que barra é a que aparece.
 */
export function shouldAiReply(e: EntradaDaDecisao): DecisaoDaIa {
  const r = e.regras;
  if (!e.chaveDoAmbiente) return { reply: false, reason: "chave_do_ambiente_desligada" };
  if (!e.chaveDoPainel) return { reply: false, reason: "chave_do_painel_desligada" };
  if (r.bloquearGrupos && (e.mensagem.ehGrupo || e.mensagem.ehTransmissaoOuStatus)) {
    return { reply: false, reason: "grupo_transmissao_ou_status" };
  }
  if (r.bloquearPessoais && e.contato.isPersonal) return { reply: false, reason: "contato_pessoal" };
  if (r.exigirOrigem) {
    if (e.conversa.salesSource !== "elo_eventos") return { reply: false, reason: "sem_origem_elo_eventos" };
    const regraDaVia = VIA_PARA_REGRA[e.conversa.salesSourceVia || ""];
    if (regraDaVia && !r[regraDaVia]) return { reply: false, reason: `origem_desligada_${e.conversa.salesSourceVia}` };
  }
  if (r.pararQuandoTransferido && e.conversa.salesStage === "transferido") {
    return { reply: false, reason: "conversa_transferida" };
  }
  if (r.respeitarPausaHumana && e.conversa.aiPausedUntil && e.conversa.aiPausedUntil > e.agora) {
    return { reply: false, reason: "pausada_atendimento_humano" };
  }
  if (r.respeitarAtendente && e.conversa.temAtendente) return { reply: false, reason: "atendente_assumiu" };
  if (r.respeitarHorario && !e.dentroDoHorario) return { reply: false, reason: "fora_do_horario" };
  if (r.aplicarLimites) {
    if (e.contadores.maxPorConversa > 0 && e.contadores.iaNaConversa >= e.contadores.maxPorConversa) {
      return { reply: false, reason: "limite_por_conversa" };
    }
    if (e.contadores.maxPorMinuto > 0 && e.contadores.iaNoUltimoMinuto >= e.contadores.maxPorMinuto) {
      return { reply: false, reason: "limite_por_minuto" };
    }
  }
  if (!e.temPlaybook) return { reply: false, reason: "sem_playbook_ativa" };
  return { reply: true, reason: "ok" };
}

// ── Marcadores da resposta ──────────────────────────────────────────────────

/**
 * A IA informa etapa e resumo em marcadores no fim da resposta; eles saem do
 * texto antes de enviar ao cliente.
 */
export function extrairMarcadoresDeVendas(texto: string): {
  texto: string;
  etapa: EtapaDeVendas | null;
  /** A etapa que a IA escreveu, antes de a transferência sobrescrever. */
  etapaPedida: EtapaDeVendas | null;
  resumo: string | null;
  transferir: boolean;
} {
  let etapa: EtapaDeVendas | null = null;
  let resumo: string | null = null;
  let transferir = false;
  const limpo = String(texto || "")
    .replace(/\[\[\s*ETAPA\s*[=:]\s*([a-z_]+)\s*\]\]/gi, (_, v: string) => {
      const e = v.toLowerCase() as EtapaDeVendas;
      if ((ETAPAS_DE_VENDAS as readonly string[]).includes(e)) etapa = e;
      return "";
    })
    .replace(/\[\[\s*RESUMO\s*[=:]\s*([^\]]{1,300})\]\]/gi, (_, v: string) => {
      resumo = v.trim();
      return "";
    })
    .replace(/\[\[\s*TRANSFERIR\s*\]\]/gi, () => {
      transferir = true;
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const etapaPedida: EtapaDeVendas | null = etapa;
  if (etapa === "transferido") transferir = true;
  if (transferir) etapa = "transferido";
  return { texto: limpo, etapa, etapaPedida, resumo, transferir };
}

// ── Valores iniciais (seed, editáveis no painel) ────────────────────────────

export const CONFIG_PADRAO = {
  listWindowDays: 30,
  refCodeScanMessages: 3,
  humanPauseMinutes: 24 * 60,
  valCommandsEnabled: true,
  maxAiMessagesPerConversation: 40,
  maxAiMessagesPerMinute: 6,
  businessHours: { ativo: false, dias: [0, 1, 2, 3, 4, 5, 6], inicio: "00:00", fim: "23:59" },
  handoff: { email: null, etiqueta: "Val · transferido", avisarNoCrm: true },
  prospecting: { tagIds: [], codigo: "ELO-WA" },
  protocol: [
    "Protocolo do sistema (não mostre ao cliente):",
    "- No FIM de toda resposta, escreva [[RESUMO=uma linha com quem é o lead e o que ele quer]].",
    "- Quando a etapa mudar, escreva [[ETAPA=qualificado]] (ou demo_solicitada, teste_solicitado, sem_interesse).",
    "- Quando a playbook mandar transferir para o Helio, escreva [[TRANSFERIR]] junto da mensagem de transferência.",
    "- Se a transferência for porque o lead aceitou a demonstração ou o teste grátis, escreva também [[ETAPA=demo_solicitada]] ou [[ETAPA=teste_solicitado]]."
  ].join("\n")
};

const TEXTO_PADRAO = "Olá! Quero ver uma demonstração do Valora Elo Eventos";

export const CODIGOS_PADRAO: Array<{ code: string; channel: string; campaignName: string; active: boolean }> = [
  { code: "ELO-EM1", channel: "email", campaignName: "E-mail 1 (Brevo)", active: true },
  { code: "ELO-EM2", channel: "email", campaignName: "E-mail 2 (Brevo)", active: true },
  { code: "ELO-EM3", channel: "email", campaignName: "E-mail 3 (Brevo)", active: true },
  { code: "ELO-SITE", channel: "site", campaignName: "Site Elo Eventos (formulário)", active: true },
  { code: "ELO-SITE-HERO", channel: "site", campaignName: "Site · botão do topo", active: true },
  { code: "ELO-SITE-PRECOS", channel: "site", campaignName: "Site · botão de preços", active: true },
  { code: "ELO-SITE-FINAL", channel: "site", campaignName: "Site · chamada final", active: true },
  { code: "ELO-SITE-FLUTUANTE", channel: "site", campaignName: "Site · botão flutuante", active: true },
  { code: "ELO-WA", channel: "whatsapp", campaignName: "Prospecção ativa por WhatsApp", active: true },
  { code: "ELO-ADS", channel: "ads", campaignName: "Anúncios Click-to-WhatsApp (futuro)", active: false }
];

export function textoPadraoDoCodigo(code: string): string {
  return `${TEXTO_PADRAO} [${code}]`;
}

export function linkDoWhatsapp(numero: string, texto: string): string {
  return `https://wa.me/${normalizarTelefone(numero)}?text=${encodeURIComponent(texto)}`;
}
