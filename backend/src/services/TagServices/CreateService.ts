import * as Yup from "yup";

import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";
import { generateColor } from "../../helpers/colorGenerator";

interface Request {
  name: string;
  color: string;
  kanban: number;
  companyId: number;
  /** Quadro próprio da conexão; ausente = Funil principal. */
  whatsappId?: number | null;
}

const CreateService = async ({
  name,
  color,
  kanban,
  companyId,
  whatsappId = null
}: Request): Promise<Tag> => {
  const schema = Yup.object().shape({
    name: Yup.string().required().min(3)
  });

  try {
    await schema.validate({ name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  if (kanban === null) {
    kanban = 0;
  }

  if (!color) {
    color = generateColor(name);
  }

  if (whatsappId) {
    const conexao = await Whatsapp.findOne({
      where: { id: whatsappId, companyId }
    });
    if (!conexao) {
      throw new AppError("Conexão não encontrada.", 404);
    }
  }

  const [tag] = await Tag.findOrCreate({
    where: { name, color, kanban, companyId, whatsappId },
    defaults: { name, color, kanban, companyId, whatsappId }
  });

  await tag.reload();

  return tag;
};

export default CreateService;
