import axios from "axios";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import Ticket from "../../models/Ticket";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import { logger } from "../../utils/logger";
import type { ChamadaDeFerramenta, FerramentasParaOBot } from "../../helpers/aiBot";

/**
 * Ferramentas do bot — o que ele CONSULTA antes de responder, diferente das
 * ações (MOVER/SALVAR), que executam depois.
 *
 * O motor não sabe de agenda, preço nem cobrança: isso mora na Valora. Aqui o
 * bot escreve um comando, este arquivo chama a porta interna da Valora (mesmo
 * segredo compartilhado do e-mail das automações) e devolve o texto para o
 * modelo escrever a resposta final. Ligado por empresa pela chave
 * `aiBotTools` (JSON com os nomes), gravada pela Valora ao provisionar o nicho.
 */

const CHAVE = "aiBotTools";

const CATALOGO: Record<string, { nomes: string[]; texto: string }> = {
  agenda: {
    nomes: ["CONSULTAR_AGENDA", "PRE_RESERVAR"],
    texto: [
      "- CONSULTAR_AGENDA — confere se uma data está livre nos salões e, se não estiver, traz datas alternativas. Use assim que souber a data (ou quando o cliente perguntar se tem vaga). Precisa do tipo de festa e do número de convidados já salvos; se faltarem, pergunte antes.",
      '  Comando: [[CONSULTAR_AGENDA data="dd/mm/aaaa"]]',
      "- PRE_RESERVAR — guarda a data por um prazo, sem compromisso, DEPOIS que o cliente disser que quer. Nunca pré-reserve sem o cliente pedir.",
      '  Comando: [[PRE_RESERVAR data="dd/mm/aaaa" salao="nome do salão" turno="nome do turno (só em festa com turno)"]]'
    ].join("\n")
  },
  proposta: {
    nomes: ["GERAR_PROPOSTA"],
    texto: [
      "- GERAR_PROPOSTA — monta a proposta com o preço da tabela para o tipo de festa, a data e o número de convidados já salvos, e devolve o LINK para o cliente. Use quando o cliente quiser saber valores ou pedir a proposta. Nunca diga um preço sem ela.",
      '  Comando: [[GERAR_PROPOSTA data="dd/mm/aaaa" pacote="nome do pacote (opcional: vazio traz todas as opções)"]]'
    ].join("\n")
  }
};

async function ferramentasLigadas(companyId: number): Promise<string[]> {
  const bruto = await GetCompanySetting(companyId, CHAVE, "[]");
  try {
    const lista = JSON.parse(bruto || "[]");
    return Array.isArray(lista) ? lista.map(String).filter(n => CATALOGO[n]) : [];
  } catch {
    return [];
  }
}

/** Ferramentas desta conversa, ou `null` quando a empresa não tem nenhuma. */
export async function ferramentasDoBot(
  ticketId: number,
  companyId: number
): Promise<FerramentasParaOBot | null> {
  const ligadas = await ferramentasLigadas(companyId);
  if (!ligadas.length) return null;
  const base = process.env.VALORA_INTERNAL_URL;
  const segredo = process.env.VALORA_INTERNAL_SECRET;
  if (!base || !segredo) {
    logger.error("[aiBot] VALORA_INTERNAL_URL ou VALORA_INTERNAL_SECRET ausente — ferramentas do bot desligadas");
    return null;
  }
  const company = await Company.findByPk(companyId, { attributes: ["id", "externalId"] });
  if (!company?.externalId) return null;
  const tenantId = company.externalId;

  const nomes = ligadas.flatMap(n => CATALOGO[n].nomes);
  const catalogo = [
    "FERRAMENTAS — o sistema executa e te devolve o resultado ANTES da sua resposta final:",
    ...ligadas.map(n => CATALOGO[n].texto),
    "Quando usar uma ferramenta, escreva SÓ o comando dela (mais os comandos SALVAR que couberem), sem texto para o cliente: o resultado volta para você e aí você escreve a resposta.",
    "Nunca invente disponibilidade: só afirme que uma data está livre ou ocupada depois do resultado de CONSULTAR_AGENDA."
  ].join("\n");

  const executar = async (chamadas: ChamadaDeFerramenta[]): Promise<string> => {
    const ticket = await Ticket.findOne({ where: { id: ticketId, companyId } });
    const contato = ticket ? await Contact.findByPk(ticket.contactId) : null;
    const campos = ticket ? await ContactCustomField.findAll({ where: { contactId: ticket.contactId } }) : [];
    const salvo = (nome: string) => campos.find(c => c.name === nome)?.value || undefined;
    const resultados: string[] = [];
    for (const ch of chamadas) {
      const rota =
        ch.nome === "CONSULTAR_AGENDA" ? "agenda/consultar"
        : ch.nome === "PRE_RESERVAR" ? "agenda/pre-reservar"
        : ch.nome === "GERAR_PROPOSTA" ? "proposta/gerar"
        : null;
      if (!rota) continue;
      const corpo = {
        tenantId,
        ticketId,
        contatoNome: contato?.name,
        contatoNumero: contato?.number,
        data: ch.args.data,
        tipo: ch.args.tipo || salvo("tipo_festa"),
        convidados: ch.args.convidados || salvo("convidados"),
        salao: ch.args.salao,
        turno: ch.args.turno,
        pacote: ch.args.pacote
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        const { data } = await axios.post(`${base.replace(/\/$/, "")}/internal/eventos/${rota}`, corpo, {
          headers: { "x-internal-secret": segredo },
          timeout: 20000
        });
        resultados.push(`${ch.nome}: ${data?.texto || "(sem resposta)"}`);
        logger.info(`[aiBot] ferramenta ${ch.nome} ticket=${ticketId}: ${String(data?.texto || "").slice(0, 80)}`);
      } catch (err: any) {
        logger.error({ ticketId, ferramenta: ch.nome, status: err?.response?.status, detalhe: err?.response?.data }, "[aiBot] ferramenta falhou");
        resultados.push(`${ch.nome}: não foi possível consultar agora (erro técnico). Diga ao cliente que vai confirmar a agenda e que uma pessoa da equipe retorna.`);
      }
    }
    return resultados.join("\n\n");
  };

  return { nomes, catalogo, executar };
}
