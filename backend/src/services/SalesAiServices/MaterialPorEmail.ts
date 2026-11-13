import axios from "axios";
import { cacheLayer } from "../../libs/cache";
import Company from "../../models/Company";
import Contact from "../../models/Contact";
import { SalesAiConfig } from "../../models/SalesAi";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import { notificarValoraPorEmail } from "../TagServices/notificarValora";
import { NOME_DO_BOT_DE_VENDAS, materialPorEmailDoProduto, produtoDaConversa } from "./salesAiRules";

/**
 * Lead que passa um e-mail ou pede o material por e-mail (Hélio, 13/11/2026,
 * caso Tropical Festas): a Val confirma uma vez na conversa (`[[EMAIL=...]]`) e
 * a apresentação do produto sai por e-mail, de contato@valorasolucoes.com com
 * a assinatura do Hélio — quem envia é a Valora, que já tem o remetente. O
 * Hélio recebe o aviso, e os lembretes pelo WhatsApp param nesta conversa.
 *
 * Uma vez por conversa. Falha aqui nunca derruba a conversa: vira aviso para o
 * Hélio mandar à mão.
 */
const VALIDADE_S = 30 * 24 * 60 * 60;

export const chaveDoMaterialPorEmail = (ticketId: number): string => `material-email:${ticketId}`;

/** O lead pediu para seguir por e-mail nesta conversa: sem lembrete pelo WhatsApp. */
export async function seguePorEmail(ticketId: number): Promise<boolean> {
  return !!(await cacheLayer.get(chaveDoMaterialPorEmail(ticketId)));
}

export async function enviarMaterialPorEmail(
  ticket: Ticket,
  contato: Contact,
  cfg: SalesAiConfig,
  email: string
): Promise<boolean> {
  const chave = chaveDoMaterialPorEmail(ticket.id);
  if (await cacheLayer.get(chave)) {
    logger.info(`[val-vendas] ticket ${ticket.id}: material por e-mail já enviado nesta conversa`);
    return false;
  }
  // Marca antes: duas respostas seguidas nunca mandam dois e-mails.
  await cacheLayer.set(chave, JSON.stringify({ email, em: new Date().toISOString() }), "EX", VALIDADE_S);

  if (!contato.email) await contato.update({ email } as any).catch(() => undefined);

  const produto = produtoDaConversa(ticket.salesSource);
  const material = materialPorEmailDoProduto(cfg.produtos, produto);
  const empresa = await Company.findByPk(ticket.companyId, { attributes: ["id", "externalId"] });
  const tenantId = empresa?.externalId;
  const avisarParaMandarAMao = async (motivo: string): Promise<void> => {
    if (!tenantId) return;
    await notificarValoraPorEmail({
      tenantId,
      ticketId: ticket.id,
      contatoNome: contato.name || "",
      contatoNumero: contato.number || "",
      gatilho: `${NOME_DO_BOT_DE_VENDAS[produto]}: lead pediu o material por e-mail`,
      observacao: `${motivo} Mande à mão para ${email}.`
    });
  };

  const base = process.env.VALORA_INTERNAL_URL;
  const segredo = process.env.VALORA_INTERNAL_SECRET;
  if (!material || !tenantId || !base || !segredo) {
    logger.warn(`[val-vendas] ticket ${ticket.id}: sem material, tenant ou ligação com a Valora para o e-mail`);
    await avisarParaMandarAMao(material ? "O sistema não conseguiu enviar o e-mail." : "Este produto não tem apresentação cadastrada.");
    return false;
  }
  try {
    await axios.post(
      `${base.replace(/\/$/, "")}/internal/crm/material-por-email`,
      {
        tenantId,
        ticketId: ticket.id,
        email,
        contatoNome: contato.name || "",
        contatoNumero: contato.number || "",
        produto,
        pdfUrl: material.url,
        pdfNome: material.nome
      },
      { headers: { "x-internal-secret": segredo }, timeout: 45000 }
    );
    logger.info(`[val-vendas] ticket ${ticket.id}: material enviado por e-mail para ${email}`);
    return true;
  } catch (err: any) {
    logger.error(
      { ticketId: ticket.id, status: err?.response?.status, detalhe: err?.response?.data },
      `[val-vendas] material por e-mail falhou: ${err?.message}`
    );
    await avisarParaMandarAMao("O envio automático falhou.");
    return false;
  }
}
