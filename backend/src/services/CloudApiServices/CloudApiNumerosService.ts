import axios from "axios";
import { randomInt } from "crypto";
import Whatsapp from "../../models/Whatsapp";
import AppError from "../../errors/AppError";
import { logger } from "../../utils/logger";
import { CHANNEL, getCompanyConnection, getToken, graphUrl } from "./CloudApiChannel";
import { verificarSaude } from "./CloudApiConnectionService";
import { mesmoNumero, nomeDaConexao, pinNovo, separarNumeroBrasileiro } from "./numerosDaContaRules";

/**
 * Mais de um número oficial na mesma conta da Meta (Hélio, 14/11/2026).
 *
 * A conexão principal (a de menor id) continua sendo a da empresa: modelos,
 * disparo e "Testar" seguem nela. Cada número novo vira uma conexão própria
 * com o MESMO WABA e o MESMO token (o usuário de sistema enxerga a conta
 * inteira), e o webhook já separa as mensagens por `phone_number_id`. A
 * assinatura do app (`subscribed_apps`) é da conta, então vale para o novo.
 *
 * Fluxo: `adicionarNumero` cadastra na Meta (ou acha o que o dono já
 * cadastrou no WhatsApp Manager) e pede o código por SMS; `confirmarNumero`
 * confere o código, registra na Cloud API com um PIN novo e cria a conexão.
 */

interface NumeroDaMeta {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  status?: string;
  platform_type?: string;
}

const CAMPOS = "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status,status,platform_type";

function erroDaMeta(err: any, padrao: string): AppError {
  const meta = err?.response?.data?.error;
  logger.warn({ status: err?.response?.status, meta }, `CloudApi: ${padrao}`);
  const detalhe = meta?.error_user_msg || meta?.error_user_title || meta?.message;
  return new AppError(detalhe ? `${padrao}: ${detalhe}` : padrao, 400);
}

async function contaPrincipal(companyId: number): Promise<{ base: Whatsapp; waba: string; token: string }> {
  const base = await getCompanyConnection(companyId);
  if (!base) throw new AppError("Conecte primeiro o número oficial principal.", 404);
  if (!base.cloudApiWabaId) {
    throw new AppError("A conexão principal não tem o WABA ID. Preencha em CRM → Canais → WhatsApp Oficial.", 400);
  }
  return { base, waba: base.cloudApiWabaId, token: getToken(base) };
}

async function numerosNaMeta(waba: string, token: string): Promise<NumeroDaMeta[]> {
  try {
    const { data } = await axios.get(graphUrl(`${waba}/phone_numbers`), {
      params: { fields: CAMPOS, limit: 50 },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000
    });
    return Array.isArray(data?.data) ? data.data : [];
  } catch (err) {
    throw erroDaMeta(err, "A Meta não devolveu os números da conta");
  }
}

/** Números da conta na Meta, com a qualidade de cada um, e qual conexão do CRM usa cada um. */
export async function numerosDaConta(companyId: number) {
  const { waba, token } = await contaPrincipal(companyId);
  const [daMeta, conexoes] = await Promise.all([
    numerosNaMeta(waba, token),
    Whatsapp.findAll({ where: { companyId, channel: CHANNEL }, order: [["id", "ASC"]] })
  ]);
  return daMeta.map(n => {
    const conexao = conexoes.find(c => c.cloudApiPhoneNumberId === n.id);
    return {
      phoneNumberId: n.id,
      numero: n.display_phone_number || "",
      nome: n.verified_name || "",
      qualidade: n.quality_rating || null,
      verificacao: n.code_verification_status || null,
      statusDoNome: n.name_status || null,
      status: n.status || null,
      conexao: conexao
        ? { id: conexao.id, name: conexao.name, ownBoard: !!conexao.ownBoard, principal: conexao.id === conexoes[0]?.id }
        : null
    };
  });
}

/**
 * Passo 1: cadastra o número na conta da Meta (se ainda não estiver) e pede o
 * código por SMS. Número já verificado no WhatsApp Manager pula o código.
 */
export async function adicionarNumero(
  companyId: number,
  dados: { numero: string; nomeDeExibicao?: string }
): Promise<{ phoneNumberId: string; numero: string; precisaCodigo: boolean }> {
  const separado = separarNumeroBrasileiro(dados.numero);
  if (!separado) throw new AppError("Número inválido. Use DDD + número, ex.: (21) 97474-4765.", 400);
  const { base, waba, token } = await contaPrincipal(companyId);
  const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 };

  let doNumero = (await numerosNaMeta(waba, token)).find(n =>
    mesmoNumero(n.display_phone_number || "", separado.cc, separado.numero)
  );
  if (!doNumero) {
    const nome = String(dados.nomeDeExibicao || base.cloudApiVerifiedName || "").trim();
    if (!nome) throw new AppError("Informe o nome de exibição do número (ex.: Valora Soluções).", 400);
    try {
      const { data } = await axios.post(
        graphUrl(`${waba}/phone_numbers`),
        { cc: separado.cc, phone_number: separado.numero, verified_name: nome },
        auth
      );
      doNumero = { id: String(data?.id), display_phone_number: `+${separado.cc} ${separado.numero}` };
    } catch (err) {
      throw erroDaMeta(err, "A Meta não aceitou o número");
    }
    logger.info(`CloudApi: número ${separado.numero} cadastrado na conta ${waba} (id ${doNumero.id})`);
  }

  const jaConectado = await Whatsapp.findOne({ where: { cloudApiPhoneNumberId: doNumero.id } });
  if (jaConectado) throw new AppError("Este número já está conectado no CRM.", 400);

  if (doNumero.code_verification_status === "VERIFIED") {
    return { phoneNumberId: doNumero.id, numero: doNumero.display_phone_number || separado.numero, precisaCodigo: false };
  }
  try {
    await axios.post(graphUrl(`${doNumero.id}/request_code`), { code_method: "SMS", language: "pt_BR" }, auth);
  } catch (err) {
    throw erroDaMeta(err, "A Meta não mandou o código por SMS");
  }
  return { phoneNumberId: doNumero.id, numero: doNumero.display_phone_number || separado.numero, precisaCodigo: true };
}

/**
 * Passo 2: confere o código do SMS (quando houver), registra o número na Cloud
 * API com um PIN novo e cria a conexão no CRM com quadro próprio. O PIN volta
 * UMA vez para a tela: é o da verificação em duas etapas do número.
 */
export async function confirmarNumero(
  companyId: number,
  phoneNumberId: string,
  dados: { codigo?: string; nome?: string; ownBoard?: boolean }
) {
  const { base, waba, token } = await contaPrincipal(companyId);
  const auth = { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 };
  const doNumero = (await numerosNaMeta(waba, token)).find(n => n.id === String(phoneNumberId));
  if (!doNumero) throw new AppError("Este número não está na conta da Meta. Comece por Adicionar número.", 404);
  if (await Whatsapp.findOne({ where: { cloudApiPhoneNumberId: doNumero.id } })) {
    throw new AppError("Este número já está conectado no CRM.", 400);
  }

  const codigo = String(dados.codigo || "").replace(/\D/g, "");
  if (doNumero.code_verification_status !== "VERIFIED") {
    if (!codigo) throw new AppError("Digite o código que chegou por SMS no número novo.", 400);
    try {
      await axios.post(graphUrl(`${doNumero.id}/verify_code`), { code: codigo }, auth);
    } catch (err) {
      throw erroDaMeta(err, "Código recusado pela Meta");
    }
  }

  const pin = pinNovo(max => randomInt(max));
  try {
    await axios.post(graphUrl(`${doNumero.id}/register`), { messaging_product: "whatsapp", pin }, auth);
  } catch (err) {
    throw erroDaMeta(err, "A Meta não registrou o número na Cloud API");
  }

  const saude = await verificarSaude(doNumero.id, token);
  const exibido = saude.displayNumber || doNumero.display_phone_number || "";
  const conexao = await Whatsapp.create({
    name: nomeDaConexao(dados.nome, exibido),
    channel: CHANNEL,
    companyId,
    status: saude.ok ? "CONNECTED" : "DISCONNECTED",
    cloudApiPhoneNumberId: doNumero.id,
    cloudApiWabaId: waba,
    // Mesmo token da principal, já cifrado: o usuário de sistema enxerga a conta toda.
    cloudApiTokenEnc: base.cloudApiTokenEnc,
    cloudApiDisplayNumber: exibido || null,
    cloudApiVerifiedName: saude.verifiedName || doNumero.verified_name || null,
    ownBoard: dados.ownBoard ?? true,
    isDefault: false
  } as any);
  logger.info(`CloudApi: conexão ${conexao.id} criada para o número ${exibido} (empresa ${companyId})`);
  return {
    conexao: { id: conexao.id, name: conexao.name, numero: exibido, ownBoard: !!conexao.ownBoard, status: conexao.status },
    pin
  };
}
