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

/**
 * O que a IA comercial vende. Um número pode vender mais de um produto: quem diz
 * qual vale numa conversa é `Tickets.salesSource`, e cada produto tem a própria
 * playbook. Regras, pausa e limites são os mesmos para todos.
 */
export const PRODUTOS_DE_VENDAS = ["elo_eventos", "valora_saude"] as const;
export type ProdutoDeVendas = (typeof PRODUTOS_DE_VENDAS)[number];

export const PRODUTO_PADRAO: ProdutoDeVendas = "elo_eventos";

export const NOME_DO_BOT_DE_VENDAS: Record<ProdutoDeVendas, string> = {
  elo_eventos: "Val Vendas",
  valora_saude: "Val Saúde"
};

export function ehProdutoDeVendas(valor: unknown): valor is ProdutoDeVendas {
  return (PRODUTOS_DE_VENDAS as readonly unknown[]).includes(valor);
}

// ── Triagem: conversa nova sem produto (11/11/2026) ─────────────────────────

/**
 * `Tickets.salesSource` de quem entrou pela Entrada do funil e ainda não disse
 * o que procura. Não é produto: a Val primeiro descobre qual é, e só então
 * segue a playbook dele (pedido do Hélio, 11/11/2026).
 */
export const TRIAGEM = "triagem";

/** Como a Val apresenta cada produto na pergunta da triagem (curto, sem preço). */
export const DESCRICAO_PARA_TRIAGEM: Record<ProdutoDeVendas, string> = {
  elo_eventos:
    "Valora Elo Eventos — para casas de festas, buffets e espaços de eventos: uma IA atende o WhatsApp em segundos, consulta a agenda, manda a proposta com os pacotes e cobra o sinal por Pix.",
  valora_saude:
    "Valora Saúde — para clínicas e médicos: o paciente paga por um link único, em até 21x no cartão, e o valor já cai dividido entre cirurgião, anestesista, instrumentador e clínica."
};

/** Etiqueta que o card ganha quando a triagem descobre o produto (o card fica na Entrada). */
export const ETIQUETA_DO_PRODUTO: Record<ProdutoDeVendas, { nome: string; cor: string }> = {
  elo_eventos: { nome: "Eventos", cor: "#22c55e" },
  valora_saude: { nome: "Valora Saude", cor: "#0E9F6E" }
};

/** Persona da triagem: só descobrir o produto, entre os que têm playbook ativa. */
export function promptDaTriagem(produtos: ProdutoDeVendas[], protocolo = ""): string {
  const lista = produtos.map(p => `- ${p}: ${DESCRICAO_PARA_TRIAGEM[p]}`).join("\n");
  const marcadores = produtos.map(p => `[[PRODUTO ${p}]]`).join(" ou ");
  return [
    "Você é a Val, da Valora. Esta conversa chegou pelo WhatsApp e ainda não sabemos qual solução a pessoa procura.",
    "",
    "Soluções que você atende por aqui:",
    lista,
    "",
    "Seu único objetivo agora é descobrir qual dessas soluções interessa à pessoa:",
    `1. Se a conversa já deixa claro (pelo assunto, pelo tipo de negócio dela ou por citar o produto), responda SOMENTE com ${marcadores}, sem nenhum outro texto. A resposta ao cliente sai depois, com o roteiro do produto.`,
    "2. Se ainda não está claro, cumprimente em uma frase curta, apresente-se como Val, da Valora, e pergunte qual é o negócio dela ou o que procura, citando as soluções acima em poucas palavras. Uma pergunta só. Não detalhe os produtos e não fale de preço.",
    "3. Se a pessoa procura outra coisa (maquininha de cartão, Valora Pay, pagamentos ou repasses de empresa, loja ou vitrine digital, suporte de quem já é cliente, fornecedor, currículo ou qualquer assunto fora das soluções acima), agradeça em uma frase, diga que vai passar para a equipe da Valora e escreva [[TRANSFERIR]].",
    "Nunca invente produto, preço ou prazo.",
    protocolo.trim()
  ]
    .filter(Boolean)
    .join("\n");
}

/** `[[PRODUTO elo_eventos]]` na resposta da triagem. Só vale produto oferecido. */
export function produtoDaTriagem(texto: string, oferecidos: ProdutoDeVendas[]): ProdutoDeVendas | null {
  const m = /\[\[\s*PRODUTO\b\s*[=:]?\s*([^\]]*)\]\]/i.exec(String(texto || ""));
  if (!m) return null;
  const valor = m[1]
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const produto: ProdutoDeVendas | null = /saude/.test(valor) ? "valora_saude" : /evento/.test(valor) ? "elo_eventos" : null;
  return produto && oferecidos.includes(produto) ? produto : null;
}

/** Na tela de consumo das IAs: qual Val gastou. */
export function origemDoUso(salesSource: string | null | undefined): "val_saude" | "val_vendas" {
  return produtoDaConversa(salesSource) === "valora_saude" ? "val_saude" : "val_vendas";
}

/** Conversa sem origem conhecida usa o produto padrão, como antes de existirem dois. */
export function produtoDaConversa(salesSource: string | null | undefined): ProdutoDeVendas {
  return ehProdutoDeVendas(salesSource) ? salesSource : PRODUTO_PADRAO;
}

export interface VideoDoProduto {
  url: string;
  legenda: string | null;
}

/** Vídeo de demonstração configurado no painel. Sem URL https, não há vídeo. */
export function videoDoProduto(
  produtos: Record<string, unknown> | null | undefined,
  produto: ProdutoDeVendas
): VideoDoProduto | null {
  const dados = (produtos?.[produto] ?? null) as { videoUrl?: unknown; videoLegenda?: unknown } | null;
  const url = String(dados?.videoUrl ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) return null;
  return { url, legenda: String(dados?.videoLegenda ?? "").trim() || null };
}

export interface TabelaDoProduto {
  url: string;
  nome: string;
}

const NOME_PADRAO_DA_TABELA = "tabela-de-taxas.pdf";

/** Tabela de taxas em PDF configurada no painel. Sem URL https, não há tabela. */
export function tabelaDoProduto(
  produtos: Record<string, unknown> | null | undefined,
  produto: ProdutoDeVendas
): TabelaDoProduto | null {
  const dados = (produtos?.[produto] ?? null) as { tabelaUrl?: unknown; tabelaNome?: unknown } | null;
  const url = String(dados?.tabelaUrl ?? "").trim();
  if (!/^https:\/\/\S+$/i.test(url)) return null;
  const nome = String(dados?.tabelaNome ?? "").trim() || NOME_PADRAO_DA_TABELA;
  return { url, nome: /\.pdf$/i.test(nome) ? nome : `${nome}.pdf` };
}

/**
 * Material que vai por e-mail quando o lead pede (Hélio, 13/11/2026, caso
 * Tropical Festas): a apresentação do produto; sem ela, a tabela em PDF.
 */
export function materialPorEmailDoProduto(
  produtos: Record<string, unknown> | null | undefined,
  produto: ProdutoDeVendas
): TabelaDoProduto | null {
  const dados = (produtos?.[produto] ?? null) as { apresentacaoUrl?: unknown; apresentacaoNome?: unknown } | null;
  const url = String(dados?.apresentacaoUrl ?? "").trim();
  if (/^https:\/\/\S+$/i.test(url)) {
    const nome = String(dados?.apresentacaoNome ?? "").trim() || "apresentacao.pdf";
    return { url, nome: /\.pdf$/i.test(nome) ? nome : `${nome}.pdf` };
  }
  return tabelaDoProduto(produtos, produto);
}

/** E-mail que o lead passou, como a IA escreveu no marcador: sem espaços, minúsculo, ou nulo. */
export function emailDoMarcador(bruto: string): string | null {
  const v = String(bruto || "")
    .replace(/^\s*["']|["']\s*$/g, "")
    .replace(/^mailto:/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return /^[^@\s"'<>]+@[^@\s"'<>]+\.[a-z]{2,}$/i.test(v) && v.length <= 120 ? v : null;
}

const CAMPOS_DO_PRODUTO = ["videoUrl", "videoLegenda", "tabelaUrl", "tabelaNome", "apresentacaoUrl", "apresentacaoNome"] as const;

/**
 * Junta os ajustes por produto que chegaram do painel com os que já estavam
 * gravados. Campo que não veio fica como estava: salvar o vídeo não apaga a
 * tabela, e vice-versa. Lança `Error` com a mensagem para o painel.
 */
export function mesclarAjustesDeProdutos(
  atuais: Record<string, unknown> | null | undefined,
  bruto: unknown
): Record<string, unknown> {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
    throw new Error("Ajustes por produto: envie um objeto.");
  }
  const saida: Record<string, unknown> = { ...(atuais || {}) };
  for (const [produto, dados] of Object.entries(bruto as Record<string, unknown>)) {
    if (!ehProdutoDeVendas(produto)) throw new Error("Produto desconhecido.");
    const novo = (dados ?? {}) as Record<string, unknown>;
    const atual = { ...((saida[produto] as Record<string, unknown>) || {}) };
    for (const campo of CAMPOS_DO_PRODUTO) {
      if (novo[campo] !== undefined) atual[campo] = String(novo[campo] ?? "").trim();
    }
    const https = (v: unknown) => !v || /^https:\/\/\S+$/i.test(String(v));
    if (!https(atual.videoUrl)) throw new Error("O vídeo precisa de um endereço https.");
    if (String(atual.videoLegenda ?? "").length > 1000) throw new Error("A legenda do vídeo passou de 1000 caracteres.");
    if (!https(atual.tabelaUrl)) throw new Error("A tabela precisa de um endereço https.");
    if (String(atual.tabelaNome ?? "").length > 120) throw new Error("O nome do arquivo da tabela passou de 120 caracteres.");
    if (!https(atual.apresentacaoUrl)) throw new Error("A apresentação precisa de um endereço https.");
    if (String(atual.apresentacaoNome ?? "").length > 120) throw new Error("O nome do arquivo da apresentação passou de 120 caracteres.");
    saida[produto] = atual;
  }
  return saida;
}

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
  /** Não responde agradecimento, conversa encerrada nem troca sem fim com outro robô. */
  evitarLoop: boolean;
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
  aplicarLimites: true,
  evitarLoop: true
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
  /** Motivo de `motivoDoLoop` para esta conversa; `null` = sem sinal de loop. */
  motivoDoLoop?: string | null;
  /** O contato é outro número da própria empresa (ex.: o Oficial falando com o QR). */
  numeroDaEmpresa?: boolean;
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
  // Fixa, sem chave no painel: com a Val em dois números da casa, uma conversa
  // entre eles vira robô respondendo robô.
  if (e.numeroDaEmpresa) return { reply: false, reason: "numero_da_empresa" };
  if (r.bloquearGrupos && (e.mensagem.ehGrupo || e.mensagem.ehTransmissaoOuStatus)) {
    return { reply: false, reason: "grupo_transmissao_ou_status" };
  }
  if (r.bloquearPessoais && e.contato.isPersonal) return { reply: false, reason: "contato_pessoal" };
  if (r.exigirOrigem) {
    // Triagem conta como origem: quem ligou foi a automação da Entrada.
    if (!ehProdutoDeVendas(e.conversa.salesSource) && e.conversa.salesSource !== TRIAGEM) {
      return { reply: false, reason: "sem_origem_elo_eventos" };
    }
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
  if (r.evitarLoop && e.motivoDoLoop) return { reply: false, reason: e.motivoDoLoop };
  if (!e.temPlaybook) return { reply: false, reason: "sem_playbook_ativa" };
  return { reply: true, reason: "ok" };
}

// ── Indicação de outra pessoa ───────────────────────────────────────────────

/**
 * O lead diz que quem cuida do assunto é outra pessoa e passa o telefone dela
 * (pedido do Hélio, 10/11/2026: "Ju, atendente da clínica, indicou o Dr. Jorge").
 * Em vez de transferir para o Hélio, a Val abre um card para o indicado, que
 * recebe a abertura da lista de disparo, e o card de quem indicou é finalizado.
 */
export interface IndicacaoDoLead {
  /** Quem foi indicado, como o lead disse ("Dr. Jorge"). Pode faltar. */
  nome: string | null;
  /** Só dígitos, com DDI (55 no Brasil). */
  numero: string;
  /**
   * O próprio lead pediu para falarmos em OUTRO número dele (11/11/2026, caso
   * Baladinha: "Me chama no 21 98399-7414"). Mesmo caminho da indicação, mas o
   * card novo é do mesmo lead.
   */
  proprio?: boolean;
}

/** Regra do sistema que vai junto da playbook: vale para Val Vendas e Val Saúde. */
export const PROTOCOLO_DA_INDICACAO = [
  "Indicação de outra pessoa (regra do sistema, vale acima da playbook):",
  '- Se o lead disser que quem cuida do assunto é outra pessoa e passar o telefone dela (no texto ou num contato compartilhado, que aparece como "👤 Contato: …"), NÃO transfira. Agradeça em uma frase curta, diga que vamos falar com essa pessoa e escreva [[INDICACAO nome="nome da pessoa indicada" numero="DDD e número"]]. Nessa resposta não escreva [[TRANSFERIR]].',
  "- Se ele indicar a pessoa sem o telefone, peça o WhatsApp dela antes.",
  '- Se o lead pedir para falarmos, chamarmos ou ligarmos em OUTRO número dele mesmo (da mesma empresa), NÃO transfira. Agradeça em uma frase curta, diga que vamos chamar nesse número pelo WhatsApp e escreva [[OUTRO_NUMERO numero="DDD e número"]]. Nessa resposta não escreva [[TRANSFERIR]].'
].join("\n");

/** Atributos de `[[INDICACAO nome="Dr. Jorge" numero="(21) 97217-2740"]]`. Sem número válido = null. */
export function lerIndicacao(atributos: string): IndicacaoDoLead | null {
  const attr: Record<string, string> = {};
  for (const m of String(atributos || "").matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/g)) {
    attr[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  }
  const numero = normalizarTelefone(attr.numero || attr.telefone || attr.whatsapp || "");
  // Brasil: 55 + DDD + 8 ou 9 dígitos. Fora do Brasil, o tamanho do E.164.
  const valido = numero.startsWith("55") ? numero.length === 12 || numero.length === 13 : numero.length >= 10 && numero.length <= 15;
  if (!valido) return null;
  const nome = (attr.nome || "").replace(/\s+/g, " ").trim().slice(0, 60) || null;
  return { nome, numero };
}

/**
 * Em que lista o indicado entra: a de disparo do produto no quadro do card.
 * Primeiro a lista em que o card de quem indicou está; depois a última de
 * disparo por onde ele passou; por fim a mais antiga.
 */
export function escolherListaDeDisparo(
  candidatas: number[],
  listasAtuais: number[],
  historicoRecenteAntes: number[]
): number | null {
  if (!candidatas.length) return null;
  const atual = listasAtuais.find(id => candidatas.includes(id));
  if (atual) return atual;
  const passou = historicoRecenteAntes.find(id => candidatas.includes(id));
  if (passou) return passou;
  return [...candidatas].sort((a, b) => a - b)[0];
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
  /** A IA pediu o vídeo de demonstração do produto. */
  video: boolean;
  /** A IA pediu a tabela de taxas em PDF. */
  tabela: boolean;
  /** O lead indicou outra pessoa (ou outro número dele): vira card novo, não transferência. */
  indicacao: IndicacaoDoLead | null;
  /** O lead passou um e-mail ou pediu o material por e-mail: a apresentação vai para este endereço. */
  email: string | null;
} {
  let etapa: EtapaDeVendas | null = null;
  let resumo: string | null = null;
  let transferir = false;
  let video = false;
  let tabela = false;
  let indicacao: IndicacaoDoLead | null = null;
  let email: string | null = null;
  const limpo = String(texto || "")
    .replace(/\[\[\s*E-?MAIL\s*[=:]\s*([^\]]{3,160})\]\]/gi, (_, v: string) => {
      email = email || emailDoMarcador(v);
      return "";
    })
    .replace(/\[\[\s*INDICA[CÇ][AÃ]O\b([^\]]*)\]\]/gi, (_, attrs: string) => {
      indicacao = indicacao || lerIndicacao(attrs);
      return "";
    })
    .replace(/\[\[\s*OUTRO[_ ]N[UÚ]MERO\b([^\]]*)\]\]/gi, (_, attrs: string) => {
      const lido = lerIndicacao(attrs);
      indicacao = indicacao || (lido ? { nome: null, numero: lido.numero, proprio: true } : null);
      return "";
    })
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
    .replace(/\[\[\s*VIDEO\s*\]\]/gi, () => {
      video = true;
      return "";
    })
    .replace(/\[\[\s*TABELA\s*\]\]/gi, () => {
      tabela = true;
      return "";
    })
    // Comando de ferramenta repetido na resposta final nunca vai para o lead.
    .replace(/\[\[\s*(?:CONSULTAR_DEMO|MARCAR_DEMO)\b[^\]]*\]\]/gi, "")
    // Marcador da triagem nunca vai para o lead.
    .replace(/\[\[\s*PRODUTO\b[^\]]*\]\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const etapaPedida: EtapaDeVendas | null = etapa;
  if (indicacao) {
    // Indicação vence a transferência: a playbook manda transferir, mas quem
    // atende o indicado é a própria Val, pelo disparo.
    transferir = false;
    if (etapa === "transferido") etapa = null;
  }
  if (etapa === "transferido") transferir = true;
  if (transferir) etapa = "transferido";
  return { texto: limpo, etapa, etapaPedida, resumo, transferir, video, tabela, indicacao, email };
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
