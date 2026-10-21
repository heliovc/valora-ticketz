import { Op } from "sequelize";
import OstraBotMessage from "../../models/OstraBotMessage";
import { FUSO } from "./ostraBotRules";

/**
 * Histórico do grupo que vai junto de cada pedido para o Mac do Hélio. A
 * página do projeto e a planilha são lidas lá, pelo Claude Code.
 */

const HISTORICO = 50;

const horaCurta = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(d);

/** Últimas 50 mensagens do grupo, da mais antiga para a mais recente. */
export const historicoDoGrupo = async (
  groupJid: string,
  ate: Date
): Promise<string> => {
  const msgs = await OstraBotMessage.findAll({
    where: { groupJid, enviadaEm: { [Op.lte]: ate } },
    order: [["enviadaEm", "DESC"]],
    limit: HISTORICO
  });
  return msgs
    .reverse()
    .map(m => `[${horaCurta(m.enviadaEm)}] ${m.autor}: ${m.texto}`)
    .join("\n");
};
