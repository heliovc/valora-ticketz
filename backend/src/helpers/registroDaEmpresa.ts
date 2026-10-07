import { ModelStatic, Model } from "sequelize";
import AppError from "../errors/AppError";

/**
 * Busca um registro pelo id SÓ dentro da empresa de quem pede.
 *
 * Vários serviços herdados do upstream buscam por `findByPk(id)` e confiam que
 * o id veio da própria empresa. Pela API qualquer usuário autenticado manda o
 * id que quiser — e aí lê, altera ou dispara com o registro de outro cliente.
 * Registro de outra empresa responde 404, igual a inexistente, para não
 * confirmar que o id existe.
 */
export async function registroDaEmpresa<M extends Model>(
  model: ModelStatic<M>,
  id: number | string | null | undefined,
  companyId: number,
  erro = "ERR_NOT_FOUND"
): Promise<M> {
  const numero = Number(id);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new AppError(erro, 404);
  }
  const registro = await model.findOne({
    where: { id: numero, companyId } as any
  });
  if (!registro) {
    throw new AppError(erro, 404);
  }
  return registro;
}
