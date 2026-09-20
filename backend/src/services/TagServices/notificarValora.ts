import axios from "axios";
import { logger } from "../../utils/logger";

/**
 * Pede à Valora que envie um e-mail de aviso.
 *
 * O motor do CRM não sabe enviar e-mail — e não deve aprender. A Valora já
 * envia (cadastro, cobrança, boas-vindas), com remetente verificado e a marca
 * do parceiro. Ensinar o CRM a mandar e-mail criaria uma segunda configuração
 * de SMTP, um segundo lugar para o remetente quebrar, e dois históricos de
 * envio para conferir quando alguém disser "não recebi".
 *
 * Por isso este arquivo é um mensageiro fino: o CRM diz o que aconteceu, a
 * Valora decide como isso vira e-mail.
 *
 * A autenticação é um segredo compartilhado, não JWT: é chamada de servidor
 * para servidor, dentro da mesma máquina, sem usuário no meio.
 */

export interface AvisoDeAutomacao {
  /**
   * O tenant da Valora (`Company.externalId`), NUNCA o `companyId` interno do
   * CRM. A Valora não conhece a numeração do motor, e a regra da casa é que o
   * tenant é sempre o `user.id` do dono.
   */
  tenantId: string;
  /** Para quem avisar. Vazio = a Valora decide (dono da conta). */
  para?: string | null;
  ticketId: number;
  contatoNome: string;
  contatoNumero: string;
  /** Nome da lista, ou "conversa nova". */
  gatilho: string;
  /** Texto livre que o usuário escreveu ao montar a automação. */
  observacao?: string | null;
}

export async function notificarValoraPorEmail(
  aviso: AvisoDeAutomacao
): Promise<boolean> {
  const base = process.env.VALORA_INTERNAL_URL;
  const segredo = process.env.VALORA_INTERNAL_SECRET;

  if (!base || !segredo) {
    // Configuração ausente é erro de instalação, não do usuário — mas não pode
    // derrubar a automação inteira: as outras ações da lista seguem valendo.
    logger.error(
      "[funnel] VALORA_INTERNAL_URL ou VALORA_INTERNAL_SECRET ausente — e-mail não enviado"
    );
    return false;
  }

  try {
    await axios.post(`${base.replace(/\/$/, "")}/internal/crm/notify`, aviso, {
      headers: { "x-internal-secret": segredo },
      timeout: 15000
    });
    return true;
  } catch (err: any) {
    logger.error(
      {
        status: err?.response?.status,
        detalhe: err?.response?.data,
        ticketId: aviso.ticketId
      },
      `[funnel] Valora recusou o aviso por e-mail: ${err?.message}`
    );
    return false;
  }
}
