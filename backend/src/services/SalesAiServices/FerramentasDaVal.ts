import axios from "axios";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { SalesAiConfig } from "../../models/SalesAi";
import type { ChamadaDeFerramenta, FerramentasParaOBot } from "../../helpers/aiBot";
import { logger } from "../../utils/logger";
import { NOME_DO_BOT_DE_VENDAS, ProdutoDeVendas, produtoDaConversa } from "./salesAiRules";
import { notificarValoraPorEmail } from "../TagServices/notificarValora";
import { avisarNoProprioWhatsapp } from "../WbotServices/AvisoNoProprioWhatsapp";

/**
 * Ferramentas da Val (Val Vendas e Val Saúde): consultar e marcar a
 * demonstração na agenda da Valora. Pedido do Hélio em 09/11/2026: "o robô
 * consegue registrar reuniões na agenda da Valora e me notifica por e-mail e
 * WhatsApp". A agenda mora na Valora (rotas `internal/agenda/demo/*`); o aviso
 * sai daqui, logo que a marcação volta confirmada.
 */
export const FERRAMENTAS_DA_VAL = ["CONSULTAR_DEMO", "MARCAR_DEMO"];

export const CATALOGO_DA_VAL = [
  "FERRAMENTAS — o sistema executa e te devolve o resultado ANTES da sua resposta final:",
  "- CONSULTAR_DEMO — horários livres para a demonstração (30 min) na agenda da Valora. Use quando o lead pedir demonstração ou reunião, ANTES de sugerir ou confirmar horário. Com o dia que o lead disse, ou sem data para ver os próximos dias.",
  '  Comando: [[CONSULTAR_DEMO data="dd/mm/aaaa (opcional)"]]',
  "- MARCAR_DEMO — marca a demonstração DEPOIS que o lead escolher um dos horários livres. Se ele quiser trocar, use de novo: a anterior é desmarcada.",
  '  Comando: [[MARCAR_DEMO data="dd/mm/aaaa" hora="hh:mm"]]',
  "Quando usar uma ferramenta, escreva SÓ o comando, sem texto para o lead: o resultado volta para você e aí você escreve a resposta.",
  "Nunca diga que um horário está livre ou marcado sem o resultado da ferramenta."
].join("\n");

/** Texto do aviso no WhatsApp do Hélio. */
export function textoDoAviso(dados: {
  produto: ProdutoDeVendas;
  quando: string;
  remarcado: boolean;
  nome?: string | null;
  numero?: string | null;
  ticketId: number;
  meetLink?: string | null;
}): string {
  const titulo = dados.remarcado ? "Demonstração REMARCADA" : "Demonstração marcada";
  return [
    `📅 ${titulo} pela ${NOME_DO_BOT_DE_VENDAS[dados.produto]}`,
    `🕒 ${dados.quando} (Brasília)`,
    `👤 ${dados.nome || "Lead"} · ${dados.numero || "sem número"}`,
    ...(dados.meetLink ? [`🔗 Google Meet: ${dados.meetLink}`] : []),
    `Card #${dados.ticketId} no CRM · está na Agenda da Valora${dados.meetLink ? " e no seu Google Agenda" : ""}.`
  ].join("\n");
}

const NOME_DO_PRODUTO: Record<ProdutoDeVendas, string> = {
  elo_eventos: "Valora Elo Eventos",
  valora_saude: "Valora Saúde"
};

/** Mensagem fixa ao lead com os dados da reunião (pedido do Hélio, 11/11/2026). */
export function mensagemDaReuniao(dados: { produto: ProdutoDeVendas; quando: string; meetLink: string }): string {
  return [
    `📅 Demonstração do ${NOME_DO_PRODUTO[dados.produto]}`,
    `🕒 ${dados.quando} (horário de Brasília), 30 minutos`,
    `🔗 Link da reunião (Google Meet): ${dados.meetLink}`,
    "",
    "É só abrir o link no horário, pelo celular ou pelo computador."
  ].join("\n");
}

/** O que a última MARCAR_DEMO desta resposta confirmou. */
export interface DemoMarcada {
  quando: string;
  remarcado: boolean;
  meetLink: string | null;
}

/**
 * Depois que a resposta da Val saiu: o card vai para "Agendamento" com a Val
 * ligada (ela remarca se o lead voltar) e, com link do Meet, o lead recebe os
 * dados da reunião numa mensagem fixa — o link não depende do modelo copiar.
 */
export async function concluirDemoMarcada(
  ticket: Ticket,
  cfg: SalesAiConfig,
  demo: DemoMarcada,
  enviar: (texto: string) => Promise<void>,
  ligarVal: (ticket: Ticket) => Promise<unknown>
): Promise<void> {
  const produto = produtoDaConversa(ticket.salesSource);
  if (demo.meetLink) {
    try {
      await enviar(mensagemDaReuniao({ produto, quando: demo.quando, meetLink: demo.meetLink }));
    } catch (err: any) {
      logger.error({ ticketId: ticket.id, err: err?.message }, "[val-agenda] envio do link do Meet falhou");
    }
  }
  // Import na hora: estático, ele muda a ordem de carga dos módulos do motor
  // (o i18n consultava o banco antes de o Sequelize subir, nos testes).
  const { moverParaAgendamento } = await import("./IndicacaoDaVal");
  await moverParaAgendamento(ticket, cfg);
  try {
    await ligarVal(ticket);
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, err: err?.message }, "[val-agenda] religar a Val falhou");
  }
}

async function avisarDemoMarcada(
  ticket: Ticket,
  contato: Contact | null,
  cfg: SalesAiConfig,
  tenantId: string,
  produto: ProdutoDeVendas,
  quando: string,
  remarcado: boolean,
  meetLink: string | null
): Promise<void> {
  const h = (cfg.handoff || {}) as { email?: string | null };
  const titulo = remarcado ? "demonstração remarcada" : "demonstração marcada";
  try {
    await notificarValoraPorEmail({
      tenantId,
      para: h.email || null,
      ticketId: ticket.id,
      contatoNome: contato?.name || "",
      contatoNumero: contato?.number || "",
      gatilho: `${NOME_DO_BOT_DE_VENDAS[produto]}: ${titulo}`,
      observacao: `${titulo[0].toUpperCase()}${titulo.slice(1)} para ${quando} (horário de Brasília). Está na Agenda da Valora${
        meetLink ? ` e no seu Google Agenda. Google Meet: ${meetLink}` : "."
      }`
    } as any);
  } catch (err: any) {
    logger.error({ ticketId: ticket.id, err: err?.message }, "[val-agenda] e-mail do aviso falhou");
  }
  await avisarNoProprioWhatsapp(
    ticket.companyId,
    textoDoAviso({ produto, quando, remarcado, nome: contato?.name, numero: contato?.number, ticketId: ticket.id, meetLink }),
    Array.isArray(cfg.whatsappIds) ? cfg.whatsappIds.map(Number) : []
  );
}

/** As ferramentas + o que a marcação confirmou nesta resposta (para depois do envio). */
export type FerramentasDaVal = FerramentasParaOBot & { demoMarcada: () => DemoMarcada | null };

/** Ferramentas desta conversa, ou `null` sem a porta interna da Valora. */
export async function ferramentasDaVal(ticket: Ticket, cfg: SalesAiConfig): Promise<FerramentasDaVal | null> {
  const base = process.env.VALORA_INTERNAL_URL;
  const segredo = process.env.VALORA_INTERNAL_SECRET;
  if (!base || !segredo) {
    logger.error("[val-agenda] VALORA_INTERNAL_URL ou VALORA_INTERNAL_SECRET ausente — Val sem agenda");
    return null;
  }
  const company = await Company.findByPk(ticket.companyId, { attributes: ["id", "externalId"] });
  if (!company?.externalId) return null;
  const tenantId = company.externalId;
  const produto = produtoDaConversa(ticket.salesSource);
  // O modelo pode repetir o comando na rodada seguinte: a mesma marcação não
  // avisa o Hélio duas vezes.
  const jaAvisados = new Set<string>();
  let marcada: DemoMarcada | null = null;

  const executar = async (chamadas: ChamadaDeFerramenta[]): Promise<string> => {
    const contato = await Contact.findByPk(ticket.contactId);
    const resultados: string[] = [];
    for (const ch of chamadas) {
      const rota = ch.nome === "CONSULTAR_DEMO" ? "consultar" : ch.nome === "MARCAR_DEMO" ? "marcar" : null;
      if (!rota) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await axios.post(
          `${base.replace(/\/$/, "")}/internal/agenda/demo/${rota}`,
          {
            tenantId,
            produto,
            ticketId: ticket.id,
            contatoNome: contato?.name,
            contatoNumero: contato?.number,
            data: ch.args.data,
            hora: ch.args.hora
          },
          { headers: { "x-internal-secret": segredo }, timeout: 20000 }
        );
        resultados.push(`${ch.nome}: ${data?.texto || "(sem resposta)"}`);
        logger.info(`[val-agenda] ${ch.nome} ticket=${ticket.id}: ${String(data?.texto || "").slice(0, 90)}`);
        if (rota === "marcar" && (data?.marcado || data?.agendaIndisponivel)) {
          const quando = data?.marcado
            ? String(data.quando)
            : `${ch.args.data || "?"} ${ch.args.hora || ""} — PEDIDO (agenda indisponível, confirmar com o lead)`;
          const meetLink = data?.marcado && typeof data?.meetLink === "string" && data.meetLink ? String(data.meetLink) : null;
          if (data?.marcado) marcada = { quando, remarcado: !!data?.remarcado, meetLink };
          if (!jaAvisados.has(quando)) {
            jaAvisados.add(quando);
            // eslint-disable-next-line no-await-in-loop
            await avisarDemoMarcada(ticket, contato, cfg, tenantId, produto, quando, !!data?.remarcado, meetLink);
          }
        }
      } catch (err: any) {
        logger.error({ ticketId: ticket.id, ferramenta: ch.nome, status: err?.response?.status }, "[val-agenda] ferramenta falhou");
        resultados.push(
          `${ch.nome}: não foi possível consultar a agenda agora. Pergunte o melhor dia e horário (dias úteis, das 9h às 18h), diga que a equipe confirma e escreva [[TRANSFERIR]].`
        );
      }
    }
    return resultados.join("\n\n");
  };

  return { nomes: FERRAMENTAS_DA_VAL, catalogo: CATALOGO_DA_VAL, executar, demoMarcada: () => marcada };
}
