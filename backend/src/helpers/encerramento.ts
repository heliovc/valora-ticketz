/**
 * "A IA encerrou a conversa" (Hélio, 29/10/2026): o lead aceitou (fechado) ou
 * recusou (perdido). Sumir não é encerramento — quem cuida do silêncio são os
 * follow-ups. Cada resultado é um gatilho em Automações; o padrão é fechado
 * avisar a equipe e perdido só aparecer no Painel (card na lista "Perdido").
 */
export type ResultadoDaIa = "fechado" | "perdido";

export const EVENTO_DO_RESULTADO: Record<ResultadoDaIa, string> = {
  fechado: "ia_fechado",
  perdido: "ia_perdido"
};

/** Gatilhos de evento aceitos na rota de Automações, além da lista e da Entrada. */
export const EVENTOS_DE_GATILHO = ["ia_humano", "ia_fechado", "ia_perdido"] as const;

export const NOME_DO_EVENTO: Record<string, string> = {
  ia_humano: "A IA passou para uma pessoa",
  ia_fechado: "A IA fechou com o cliente",
  ia_perdido: "O cliente recusou (IA)"
};

/** O que o modelo escreveu em `[[ENCERRAR resultado="..."]]`, tolerante a variações. */
export function lerResultado(bruto: string | undefined | null): ResultadoDaIa | null {
  const t = String(bruto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (["fechado", "fechou", "ganho", "aceitou", "ganhou"].includes(t)) return "fechado";
  if (["perdido", "perdeu", "recusou", "sem_interesse", "sem interesse"].includes(t)) return "perdido";
  return null;
}

/**
 * Val Vendas: a etapa que ela marca já diz o resultado. Só conta a MUDANÇA —
 * a mesma etapa repetida na resposta seguinte não dispara o gatilho de novo.
 */
export function resultadoDaEtapaDeVendas(
  anterior: string | null | undefined,
  nova: string | null | undefined
): ResultadoDaIa | null {
  if (!nova || nova === anterior) return null;
  if (nova === "sem_interesse") return "perdido";
  if (nova === "demo_solicitada" || nova === "teste_solicitado") return "fechado";
  return null;
}
