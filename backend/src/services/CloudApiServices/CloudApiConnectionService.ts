import axios from "axios";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { encryptCloudApiToken } from "../../helpers/cloudApiCrypto";
import {
  CHANNEL,
  getCompanyConnection,
  getToken,
  graphUrl
} from "./CloudApiChannel";

/**
 * Cadastro e saúde da conexão do WhatsApp Oficial.
 *
 * O canal não tem QR Code nem sessão: ou as credenciais estão certas e a Meta
 * responde, ou não estão. É isso que `status` significa aqui — e por isso
 * reusamos o mesmo vocabulário (`CONNECTED`/`DISCONNECTED`) do resto do sistema,
 * para que toda a tela existente continue funcionando sem saber do canal novo.
 */

export interface DadosDaConexao {
  phoneNumberId: string;
  wabaId?: string;
  /** Só quando trocar; ausente mantém o token já gravado. */
  token?: string;
  name?: string;
}

export interface SaudeDaConexao {
  ok: boolean;
  verifiedName?: string;
  displayNumber?: string;
  qualityRating?: string;
  erro?: string;
}

/**
 * Pergunta à Meta se a credencial vale, e de quem é o número.
 *
 * É a única prova real de que a conexão funciona — e é o que a tela chama no
 * botão "Testar conexão", para o dono não descobrir que está errado só quando
 * um cliente escrever.
 */
export async function verificarSaude(
  phoneNumberId: string,
  token: string
): Promise<SaudeDaConexao> {
  try {
    const { data } = await axios.get(graphUrl(phoneNumberId), {
      params: {
        fields: "verified_name,display_phone_number,quality_rating"
      },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    return {
      ok: true,
      verifiedName: data?.verified_name,
      displayNumber: data?.display_phone_number,
      qualityRating: data?.quality_rating
    };
  } catch (err: any) {
    const meta = err?.response?.data?.error;
    logger.warn(
      { status: err?.response?.status, meta },
      "CloudApi: verificação de saúde falhou"
    );
    return {
      ok: false,
      erro:
        meta?.message ||
        "A Meta não aceitou essas credenciais. Confira o identificador do número e o token."
    };
  }
}

/**
 * Cria ou atualiza a conexão oficial da empresa.
 *
 * Só grava depois de a Meta confirmar as credenciais: conexão que nasce quebrada
 * é pior que conexão que não nasce — ela aparece na tela como se estivesse
 * pronta.
 */
export async function salvarConexao(
  companyId: number,
  dados: DadosDaConexao
): Promise<Whatsapp> {
  const phoneNumberId = (dados.phoneNumberId || "").trim();
  if (!phoneNumberId) {
    throw new AppError("Informe o identificador do número (Phone Number ID).");
  }

  const existente = await getCompanyConnection(companyId);
  const token = dados.token?.trim()
    ? dados.token.trim()
    : existente
    ? getToken(existente)
    : "";

  if (!token) {
    throw new AppError("Informe o token de acesso da Meta.");
  }

  // Outro tenant já usa este número? O índice é único e o erro cru do banco não
  // diria nada ao usuário.
  const deOutro = await Whatsapp.findOne({
    where: { cloudApiPhoneNumberId: phoneNumberId }
  });
  if (deOutro && deOutro.companyId !== companyId) {
    throw new AppError("Este número já está conectado em outra conta.");
  }

  const saude = await verificarSaude(phoneNumberId, token);
  if (!saude.ok) {
    throw new AppError(saude.erro || "Credenciais recusadas pela Meta.", 400);
  }

  const campos = {
    name: dados.name?.trim() || saude.verifiedName || "WhatsApp Oficial",
    channel: CHANNEL,
    companyId,
    status: "CONNECTED",
    cloudApiPhoneNumberId: phoneNumberId,
    cloudApiWabaId: dados.wabaId?.trim() || existente?.cloudApiWabaId || null,
    cloudApiTokenEnc: encryptCloudApiToken(token),
    cloudApiDisplayNumber: saude.displayNumber || null,
    cloudApiVerifiedName: saude.verifiedName || null
  };

  if (existente) {
    await existente.update(campos as any);
    return existente;
  }

  return Whatsapp.create({ ...campos, isDefault: false } as any);
}

/** Estado atual para a tela. NUNCA devolve o token. */
export async function descreverConexao(companyId: number) {
  const conexao = await getCompanyConnection(companyId);
  if (!conexao) return null;

  return {
    id: conexao.id,
    name: conexao.name,
    status: conexao.status,
    phoneNumberId: conexao.cloudApiPhoneNumberId,
    wabaId: conexao.cloudApiWabaId,
    displayNumber: conexao.cloudApiDisplayNumber,
    verifiedName: conexao.cloudApiVerifiedName,
    temToken: !!conexao.cloudApiTokenEnc
  };
}

/** Revalida a credencial e atualiza o status gravado. */
export async function revalidar(companyId: number): Promise<SaudeDaConexao> {
  const conexao = await getCompanyConnection(companyId);
  if (!conexao) {
    throw new AppError("Nenhuma conexão de WhatsApp Oficial configurada.", 404);
  }
  const saude = await verificarSaude(
    conexao.cloudApiPhoneNumberId,
    getToken(conexao)
  );
  await conexao.update({
    status: saude.ok ? "CONNECTED" : "DISCONNECTED",
    ...(saude.ok
      ? {
          cloudApiDisplayNumber: saude.displayNumber || null,
          cloudApiVerifiedName: saude.verifiedName || null
        }
      : {})
  } as any);
  return saude;
}
