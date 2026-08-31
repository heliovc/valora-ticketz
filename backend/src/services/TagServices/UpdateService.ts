import * as Yup from "yup";

import AppError from "../../errors/AppError";
import Tag from "../../models/Tag";
import ShowService from "./ShowService";

interface TagData {
  id?: number;
  name?: string;
  color?: string;
  kanban?: number;
  // Gatilho da lista — ver `queues/tagAutomation.ts`.
  autoMessage?: string | null;
  autoDelayMinutes?: number;
  autoOnce?: boolean;
  autoBusinessHoursOnly?: boolean;
}

interface Request {
  tagData: TagData;
  id: number;
  companyId: number;
}

const UpdateUserService = async ({
  tagData,
  id,
  companyId
}: Request): Promise<Tag | undefined> => {
  const tag = await ShowService(id, companyId);

  const schema = Yup.object().shape({
    name: Yup.string().min(3)
  });

  const {
    name,
    color,
    kanban,
    autoMessage,
    autoDelayMinutes,
    autoOnce,
    autoBusinessHoursOnly
  } = tagData;

  try {
    await schema.validate({ name });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  // Campo do gatilho ausente no payload = não mexer. Só quem manda a chave
  // muda a regra; assim a tela de renomear lista não apaga a automação.
  const gatilho: Record<string, unknown> = {};
  if (autoMessage !== undefined) {
    gatilho.autoMessage = autoMessage?.trim() ? autoMessage.trim() : null;
  }
  if (autoDelayMinutes !== undefined) {
    // Teto de 7 dias: atraso maior que isso é agendamento, não gatilho.
    gatilho.autoDelayMinutes = Math.min(
      Math.max(0, Math.trunc(Number(autoDelayMinutes) || 0)),
      60 * 24 * 7
    );
  }
  if (autoOnce !== undefined) gatilho.autoOnce = !!autoOnce;
  if (autoBusinessHoursOnly !== undefined) {
    gatilho.autoBusinessHoursOnly = !!autoBusinessHoursOnly;
  }

  await tag.update({
    name,
    color,
    kanban,
    ...gatilho
  });

  await tag.reload();
  return tag;
};

export default UpdateUserService;
