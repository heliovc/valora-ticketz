import fs from "fs";
import path from "path";
import AiBotFile from "../../models/AiBotFile";
import AppError from "../../errors/AppError";
import uploadPrivateConfig from "../../config/privateFiles";
import { extrairTexto, EXTENSOES_ACEITAS } from "../../helpers/aiBotFileText";

/**
 * Arquivos de consulta do bot, por empresa.
 *
 * TODA consulta filtra por `companyId`. O id sozinho nunca basta: sem o par
 * (id, companyId) um lojista apagaria ou leria o arquivo de outro só por
 * adivinhar o número.
 */

/** Teto de arquivos por empresa — o conteúdo inteiro entra no prompt. */
export const MAX_ARQUIVOS_POR_EMPRESA = 10;

interface CreateRequest {
  companyId: number;
  file: Express.Multer.File;
}

function apagarDoDisco(filename: string): void {
  try {
    fs.unlinkSync(path.resolve(uploadPrivateConfig.directory, filename));
  } catch {
    // Arquivo já sumiu do disco: o registro ainda precisa ir embora.
  }
}

export const CreateAiBotFileService = async ({
  companyId,
  file
}: CreateRequest): Promise<AiBotFile> => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!EXTENSOES_ACEITAS.includes(ext)) {
    apagarDoDisco(file.filename);
    throw new AppError(
      `Tipo de arquivo não aceito (${ext || "sem extensão"}). Aceitos: ${EXTENSOES_ACEITAS.join(", ")}`,
      400
    );
  }

  const total = await AiBotFile.count({ where: { companyId } });
  if (total >= MAX_ARQUIVOS_POR_EMPRESA) {
    apagarDoDisco(file.filename);
    throw new AppError(
      `Limite de ${MAX_ARQUIVOS_POR_EMPRESA} arquivos atingido. Remova um antes de subir outro.`,
      400
    );
  }

  const caminho = path.resolve(uploadPrivateConfig.directory, file.filename);
  const texto = await extrairTexto(caminho, file.originalname);

  return AiBotFile.create({
    name: file.originalname,
    mimetype: file.mimetype,
    filename: file.filename,
    size: file.size,
    extractedText: texto,
    charCount: texto.length,
    companyId
  });
};

/** Lista para a tela: sem o texto extraído, que pode ter dezenas de milhares de caracteres. */
export const ListAiBotFilesService = async (
  companyId: number
): Promise<AiBotFile[]> =>
  AiBotFile.findAll({
    where: { companyId },
    attributes: ["id", "name", "mimetype", "size", "charCount", "createdAt"],
    order: [["createdAt", "ASC"]]
  });

/** Para o prompt: só nome e texto, na ordem em que foram subidos. */
export const ListAiBotFileTextsService = async (
  companyId: number
): Promise<{ name: string; text: string }[]> => {
  const arquivos = await AiBotFile.findAll({
    where: { companyId },
    attributes: ["name", "extractedText"],
    order: [["createdAt", "ASC"]]
  });

  return arquivos
    .filter(a => (a.extractedText || "").trim())
    .map(a => ({ name: a.name, text: a.extractedText }));
};

export const DeleteAiBotFileService = async (
  id: number,
  companyId: number
): Promise<void> => {
  const arquivo = await AiBotFile.findOne({ where: { id, companyId } });

  if (!arquivo) {
    throw new AppError("ERR_NO_FILE_FOUND", 404);
  }

  apagarDoDisco(arquivo.filename);
  await arquivo.destroy();
};
