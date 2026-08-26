import AppError from "../../errors/AppError";
import QuickMessage from "../../models/QuickMessage";

/**
 * Confere que a resposta rapida e da empresa de quem pediu.
 *
 * Show/Update/Delete buscavam so por id: qualquer usuario autenticado lia e
 * apagava a resposta de outra empresa chutando o numero.
 */
const assertInCompany = async (
  id: string | number,
  companyId: number
): Promise<QuickMessage> => {
  const record = await QuickMessage.findByPk(id);

  // 404 e nao 403: dizer "existe, mas nao e sua" ja entrega que aquele id
  // existe em outra empresa.
  if (!record || record.companyId !== companyId) {
    throw new AppError("ERR_NO_QUICKMESSAGE_FOUND", 404);
  }

  return record;
};

export default assertInCompany;
