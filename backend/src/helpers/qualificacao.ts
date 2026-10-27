/**
 * Qualificação estruturada do lead — regras puras, sem banco.
 *
 * Os campos que o bot coleta (`aiBotFields`) ganharam metadados opcionais:
 * tipo, a quem se aplicam, obrigatoriedade, ordem e opções. Com eles o motor
 * passa a decidir, em vez do modelo, QUAL é a próxima pergunta (uma por vez),
 * o que já está respondido e se o valor informado é válido. Campo sem
 * metadado continua como antes: o modelo pergunta quando quiser.
 *
 * Nasceu com o Elo Eventos (26/10/2026), mas é de qualquer nicho: "aplica a"
 * olha o valor de um campo seletor (ex.: `tipo_festa`) e nada aqui conhece
 * festa alguma.
 */

export type TipoDeCampo = "texto" | "data" | "numero" | "moeda" | "opcao" | "sim_nao";

export interface CampoQualificavel {
  nome: string;
  descricao: string;
  tipo?: TipoDeCampo;
  /** 'comum' ou valores do campo seletor para os quais o campo vale. Vazio = sempre. */
  aplicaA?: string[];
  obrigatorio?: boolean;
  ordem?: number;
  opcoes?: string[];
}

/** Contexto de nota gravado pela Valora (`aiBotLeadScore`): capacidade e piso de preço por valor do seletor. */
export interface ContextoDeNota {
  seletor?: string;
  campoData?: string;
  campoConvidados?: string;
  campoOrcamento?: string;
  capacidade?: Record<string, number>;
  piso?: Record<string, number>;
}

export type NotaDoLead = "quente" | "morno" | "frio";

export const SELETOR_PADRAO = "tipo_festa";

export const normal = (t: string): string =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Os campos têm metadados de qualificação? Sem eles, o motor não interfere. */
export function temQualificacao(campos: CampoQualificavel[]): boolean {
  return campos.some(c => (c.aplicaA && c.aplicaA.length > 0) || c.obrigatorio !== undefined || !!c.tipo);
}

function valorSalvo(salvos: Record<string, string>, nome: string): string {
  const chave = Object.keys(salvos).find(k => normal(k) === normal(nome));
  return chave ? String(salvos[chave] || "").trim() : "";
}

/** Valor atual do campo seletor (ex.: "casamento"), normalizado. */
export function valorDoSeletor(salvos: Record<string, string>, seletor = SELETOR_PADRAO): string {
  return normal(valorSalvo(salvos, seletor));
}

/** Campos que valem para este lead, na ordem de pergunta. */
export function camposAplicaveis(
  campos: CampoQualificavel[],
  salvos: Record<string, string>,
  seletor = SELETOR_PADRAO
): CampoQualificavel[] {
  const tipo = valorDoSeletor(salvos, seletor);
  return campos
    .filter(c => {
      if (!c.aplicaA || c.aplicaA.length === 0) return true;
      return c.aplicaA.some(a => normal(a) === "comum" || (tipo && normal(a) === tipo));
    })
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.ordem ?? 999) - (b.c.ordem ?? 999) || a.i - b.i)
    .map(x => x.c);
}

export interface EstadoDaQualificacao {
  aplicaveis: CampoQualificavel[];
  preenchidos: CampoQualificavel[];
  faltam: CampoQualificavel[];
  faltamObrigatorios: CampoQualificavel[];
  /** O que perguntar agora: o primeiro que falta, obrigatório antes de opcional. */
  proximo: CampoQualificavel | null;
}

export function estadoDaQualificacao(
  campos: CampoQualificavel[],
  salvos: Record<string, string>,
  seletor = SELETOR_PADRAO
): EstadoDaQualificacao {
  const aplicaveis = camposAplicaveis(campos, salvos, seletor);
  const preenchidos = aplicaveis.filter(c => valorSalvo(salvos, c.nome));
  const faltam = aplicaveis.filter(c => !valorSalvo(salvos, c.nome));
  const faltamObrigatorios = faltam.filter(c => c.obrigatorio);
  const proximo = faltamObrigatorios[0] ?? faltam[0] ?? null;
  return { aplicaveis, preenchidos, faltam, faltamObrigatorios, proximo };
}

// ───────────── Validação por tipo ─────────────

export type Validacao = { ok: true; valor: string } | { ok: false; motivo: string };

const MESES: Record<string, number> = {
  jan: 1, janeiro: 1, fev: 2, fevereiro: 2, mar: 3, marco: 3, abr: 4, abril: 4, mai: 5, maio: 5,
  jun: 6, junho: 6, jul: 7, julho: 7, ago: 8, agosto: 8, set: 9, setembro: 9, out: 10, outubro: 10,
  nov: 11, novembro: 11, dez: 12, dezembro: 12
};

const pad = (n: number) => String(n).padStart(2, "0");

function anoDeDoisDigitos(a: number): number {
  return a < 100 ? 2000 + a : a;
}

/**
 * "14/03/2027", "14/3/27", "2027-03-14", "14 de março de 2027", "março de 2027",
 * "03/2027", "14/03" (próxima ocorrência). Devolve ISO: AAAA-MM-DD ou AAAA-MM.
 */
export function interpretarData(bruto: string, hoje = new Date()): string | null {
  const t = normal(bruto).replace(/\s+/g, " ");
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  // O próprio formato que esta função devolve para "só o mês" (AAAA-MM): sem
  // isso, o modelo salvava "2027-03" e na mensagem seguinte o valor era recusado.
  m = t.match(/^(\d{4})-(\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${anoDeDoisDigitos(+m[3])}-${pad(+m[2])}-${pad(+m[1])}`;
  m = t.match(/(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?/);
  if (m && MESES[m[2]]) {
    const ano = m[3] ? +m[3] : proximoAno(MESES[m[2]], +m[1], hoje);
    return `${ano}-${pad(MESES[m[2]])}-${pad(+m[1])}`;
  }
  m = t.match(/(\d{1,2})\/(\d{4})/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = t.match(/\b([a-z]+)(?: de |\/| )(\d{4})\b/);
  if (m && MESES[m[1]]) return `${m[2]}-${pad(MESES[m[1]])}`;
  m = t.match(/(\d{1,2})\/(\d{1,2})\b/);
  if (m && +m[2] >= 1 && +m[2] <= 12) {
    const ano = proximoAno(+m[2], +m[1], hoje);
    return `${ano}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  // Só o nome do mês, em qualquer posição ("em dezembro", "lá pra março"):
  // a próxima ocorrência dele.
  const mesSolto = t.split(/[^a-z]+/).find(w => MESES[w]);
  if (mesSolto) {
    const mes = MESES[mesSolto];
    const ano = mes > hoje.getMonth() + 1 ? hoje.getFullYear() : hoje.getFullYear() + 1;
    return `${ano}-${pad(mes)}`;
  }
  return null;
}

function proximoAno(mes: number, dia: number, hoje: Date): number {
  const candidato = new Date(hoje.getFullYear(), mes - 1, dia);
  return candidato >= hoje ? hoje.getFullYear() : hoje.getFullYear() + 1;
}

/** "120", "uns 120 convidados", "100 a 150" (fica o maior). */
export function interpretarNumero(bruto: string): number | null {
  const nums = (normal(bruto).match(/\d+(?:[.,]\d+)?/g) || []).map(n => Number(n.replace(/\./g, "").replace(",", ".")));
  if (!nums.length) return null;
  return Math.round(Math.max(...nums));
}

/** "R$ 30.000", "30 mil", "30k", "entre 20 e 30 mil" (fica o maior), "25.000,00". */
export function interpretarMoeda(bruto: string): number | null {
  const t = normal(bruto).replace(/r\$/g, " ");
  const achados: number[] = [];
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)*)\s*(mil|k)?/g)) {
    let n = m[1];
    // "30.000,00" → 30000.00 · "30,5" → 30.5 · "25.000" → 25000
    if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, "").replace(",", ".");
    else n = n.replace(/[.,]/g, "");
    let v = Number(n);
    if (!Number.isFinite(v)) continue;
    if (m[2]) v *= 1000;
    achados.push(v);
  }
  if (!achados.length) return null;
  // "entre 20 e 30 mil": só o último levou o "mil"; os anteriores menores que 1000 acompanham.
  const maior = Math.max(...achados);
  return Math.round(maior);
}

export function interpretarSimNao(bruto: string): "sim" | "não" | null {
  const t = normal(bruto);
  if (/^(s|sim|claro|pode|com certeza|isso|positivo|quero|yes|ok|aham|uhum)\b/.test(t) || /\bsim\b/.test(t)) return "sim";
  if (/^(n|nao|nunca|negativo|jamais|no)\b/.test(t) || /\bnao\b/.test(t)) return "não";
  return null;
}

/** Sinônimos comuns para as opções do Elo Eventos; outras opções casam por texto. */
const SINONIMOS: Record<string, string[]> = {
  casamento: ["casamento", "casar", "noiva", "noivo", "wedding", "mini wedding", "bodas"],
  "15_anos": ["15 anos", "15", "quinze", "debutante", "quinze anos", "15anos"],
  infantil: ["infantil", "crianca", "criancas", "kids", "aniversario infantil", "festinha", "filho", "filha"],
  manha: ["manha", "de manha", "cedo"],
  tarde: ["tarde", "a tarde"],
  noite: ["noite", "a noite", "noturno"]
};

export function interpretarOpcao(bruto: string, opcoes: string[]): string | null {
  const t = normal(bruto);
  if (!t) return null;
  for (const op of opcoes) {
    const alvo = normal(op);
    if (t === alvo || t.includes(alvo) || alvo.includes(t)) return op;
    const sin = SINONIMOS[alvo] || SINONIMOS[alvo.replace(/\s+/g, "_")] || [];
    if (sin.some(s => t === normal(s) || t.includes(normal(s)))) return op;
  }
  return null;
}

export function validarValor(campo: CampoQualificavel, bruto: string, hoje = new Date()): Validacao {
  const texto = String(bruto || "").replace(/\s+/g, " ").trim();
  if (!texto) return { ok: false, motivo: "valor vazio" };
  switch (campo.tipo) {
    case "data": {
      const iso = interpretarData(texto, hoje);
      return iso ? { ok: true, valor: iso } : { ok: false, motivo: `"${texto}" não é uma data` };
    }
    case "numero": {
      const n = interpretarNumero(texto);
      return n !== null ? { ok: true, valor: String(n) } : { ok: false, motivo: `"${texto}" não é um número` };
    }
    case "moeda": {
      const n = interpretarMoeda(texto);
      return n !== null ? { ok: true, valor: String(n) } : { ok: false, motivo: `"${texto}" não é um valor` };
    }
    case "sim_nao": {
      const v = interpretarSimNao(texto);
      return v ? { ok: true, valor: v } : { ok: false, motivo: `"${texto}" não é sim nem não` };
    }
    case "opcao": {
      const v = interpretarOpcao(texto, campo.opcoes || []);
      return v ? { ok: true, valor: v } : { ok: false, motivo: `"${texto}" não é uma das opções (${(campo.opcoes || []).join(", ")})` };
    }
    default:
      return { ok: true, valor: texto.slice(0, 300) };
  }
}

// ───────────── Nota do lead ─────────────

/**
 * quente = data em até 12 meses + convidados dentro da capacidade (+ orçamento
 * acima do piso, SE o orçamento foi informado) · morno = falta UM · frio = sem
 * data (ou falta mais de um). `null` = ainda não dá para dizer (faltam convidados).
 * Orçamento virou opcional em 27/10/2026: o Elo Eventos não pergunta mais.
 */
export function notaDoLead(
  salvos: Record<string, string>,
  ctx: ContextoDeNota = {},
  hoje = new Date()
): NotaDoLead | null {
  const seletor = ctx.seletor || SELETOR_PADRAO;
  const tipo = valorDoSeletor(salvos, seletor);
  const data = valorSalvo(salvos, ctx.campoData || "data_festa");
  const convidados = interpretarNumero(valorSalvo(salvos, ctx.campoConvidados || "convidados"));
  const orcamento = interpretarMoeda(valorSalvo(salvos, ctx.campoOrcamento || "orcamento"));
  if (convidados === null) return null;

  let dataOk = false;
  const iso = interpretarData(data, hoje);
  if (iso) {
    const [a, m, d] = iso.split("-").map(Number);
    const quando = new Date(a, m - 1, d || 1);
    const limite = new Date(hoje);
    limite.setMonth(limite.getMonth() + 12);
    const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    dataOk = quando >= inicioDoMes && quando <= limite;
  }
  const capacidade = tipo && ctx.capacidade ? ctx.capacidade[tipo] : undefined;
  const piso = tipo && ctx.piso ? ctx.piso[tipo] : undefined;
  const capacidadeOk = capacidade === undefined || convidados <= capacidade;
  const orcamentoOk = orcamento === null || piso === undefined || orcamento >= piso;
  if (!iso) return "frio";
  const faltas = [dataOk, capacidadeOk, orcamentoOk].filter(ok => !ok).length;
  if (faltas === 0) return "quente";
  if (faltas === 1) return "morno";
  return "frio";
}

// ───────────── Bloco do prompt ─────────────

/** O que o modelo lê: situação dos campos e a ÚNICA pergunta da vez. */
export function blocoDeQualificacao(
  estado: EstadoDaQualificacao,
  salvos: Record<string, string>,
  nota: NotaDoLead | null
): string {
  const linhas: string[] = ["QUALIFICAÇÃO DO LEAD (uma pergunta por vez)"];
  if (estado.aplicaveis.length) {
    linhas.push("Situação dos dados:");
    for (const c of estado.aplicaveis) {
      const v = valorSalvo(salvos, c.nome);
      linhas.push(v ? `- ${c.nome}: ${v} ✔` : `- ${c.nome}: (falta)${c.obrigatorio ? " *obrigatório*" : ""}`);
    }
  }
  if (estado.proximo) {
    const p = estado.proximo;
    linhas.push(
      "",
      `PRÓXIMA PERGUNTA: ${p.nome} — ${p.descricao}${p.opcoes?.length ? ` Opções: ${p.opcoes.join(", ")}.` : ""}`,
      "Regras:",
      "- Antes de perguntar, releia a CONVERSA INTEIRA. Se o cliente já informou qualquer dado da lista, nesta mensagem ou em mensagens anteriores, grave cada um com SALVAR e NÃO pergunte de novo: passe para o próximo que realmente falta.",
      "- Se o cliente fez uma pergunta (datas livres, pacotes, valores, como funciona), RESPONDA PRIMEIRO, usando a ferramenta quando houver, e só depois faça a pergunta da vez.",
      "- Nunca condicione uma resposta a um dado de cadastro. Responder a dúvida vem antes de completar a ficha.",
      "- Faça SÓ uma pergunta por mensagem, de forma natural e curta.",
      "- Nunca pergunte de novo o que já está marcado com ✔."
    );
  } else if (estado.aplicaveis.length) {
    linhas.push("", "Qualificação completa: não falta dado. Não faça mais perguntas de cadastro; siga o foco da etapa.");
  }
  if (nota) linhas.push("", `Nota atual do lead: ${nota}.`);
  return linhas.join("\n");
}

// ───────────── Leitura do histórico ─────────────

const temPalavra = (texto: string, termo: string): boolean => {
  const t = normal(termo);
  if (!t || /^\d+$/.test(t)) return false; // número solto ("15") não decide nada: "seremos 150"
  return new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(texto);
};

/**
 * Dados que o CLIENTE já disse nas mensagens dele e que ainda estão vazios —
 * sem depender do modelo lembrar de salvar. Só o que é inequívoco:
 * - opção (ex.: tipo de festa) por palavra inteira, nunca por número solto;
 * - data com nome de mês ou no formato dd/mm/aaaa ou mm/aaaa;
 * - número só quando vem com "pessoas" ou "convidados".
 * A mensagem mais recente vence. Nasceu da conversa "Mariana" (27/10/2026):
 * ela disse "casamento em março do ano que vem" e a IA perguntou de novo.
 */
export function extrairDoHistorico(
  campos: CampoQualificavel[],
  salvos: Record<string, string>,
  mensagensDoCliente: string[],
  hoje = new Date()
): Record<string, string> {
  const achados: Record<string, string> = {};
  const vazios = campos.filter(c => !valorSalvo(salvos, c.nome));
  for (const bruto of mensagensDoCliente) {
    const t = normal(bruto).replace(/\s+/g, " ");
    if (!t) continue;
    for (const c of vazios) {
      if (c.tipo === "opcao" && c.opcoes?.length) {
        const op = c.opcoes.find(o => {
          const alvo = normal(o);
          const sin = SINONIMOS[alvo] || SINONIMOS[alvo.replace(/\s+/g, "_")] || [];
          return temPalavra(t, alvo.replace(/_/g, " ")) || sin.some(x => temPalavra(t, x));
        });
        if (op) achados[c.nome] = op;
      } else if (c.tipo === "data") {
        const temMes = t.split(/[^a-z]+/).some(w => MESES[w]);
        const temFormato = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}\/\d{4}\b/.test(t);
        if (temMes || temFormato) {
          const iso = interpretarData(t, hoje);
          if (iso) achados[c.nome] = iso;
        }
      } else if (c.tipo === "numero" && /convidad|pessoa/.test(normal(c.nome + " " + c.descricao))) {
        const m = t.match(/(\d{2,4})\s*(?:pessoas|convidados)/);
        if (m) achados[c.nome] = String(Number(m[1]));
      }
    }
  }
  return achados;
}

