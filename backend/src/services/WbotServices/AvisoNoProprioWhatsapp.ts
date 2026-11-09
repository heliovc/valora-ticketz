import Whatsapp from "../../models/Whatsapp";
import { getWbot } from "../../libs/wbot";
import { logger } from "../../utils/logger";

/**
 * Aviso para o próprio dono da conta no WhatsApp: o número normal (QR) manda a
 * mensagem para ele mesmo — aparece no chat "Você" do celular. Pedido do Hélio
 * (09/11/2026) para saber na hora quando a Val marca uma demonstração.
 *
 * Mensagem nossa para nós mesmos chega ao listener como `fromMe`: não liga bot
 * nem dispara a Entrada do funil. Nunca lança.
 */
export async function avisarNoProprioWhatsapp(
  companyId: number,
  texto: string,
  preferidos: number[] = []
): Promise<boolean> {
  try {
    const conexoes = await Whatsapp.findAll({
      where: { companyId, channel: "whatsapp", status: "CONNECTED" } as any,
      attributes: ["id"],
      order: [["id", "ASC"]]
    });
    const ordem = [
      ...preferidos.filter(id => conexoes.some(c => c.id === id)),
      ...conexoes.map(c => c.id).filter(id => !preferidos.includes(id))
    ];
    for (const id of ordem) {
      try {
        const wbot = getWbot(id) as any;
        const eu = wbot?.myJid;
        if (!eu) continue;
        // eslint-disable-next-line no-await-in-loop
        await wbot.sendMessage(eu, { text: texto });
        logger.info(`[aviso] enviado para o próprio WhatsApp pela conexão ${id}`);
        return true;
      } catch (err: any) {
        logger.warn({ companyId, whatsappId: id, err: err?.message }, "[aviso] conexão não enviou para o próprio número");
      }
    }
    logger.warn({ companyId }, "[aviso] nenhuma conexão por QR conectada para avisar no WhatsApp");
    return false;
  } catch (err: any) {
    logger.error({ companyId, err: err?.message }, "[aviso] falha ao avisar no próprio WhatsApp");
    return false;
  }
}
