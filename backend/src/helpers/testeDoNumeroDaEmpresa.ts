import { brNumberVariants } from "./brPhone";

/**
 * Exceção TEMPORÁRIA à trava "a Val não conversa com número da própria
 * empresa", pedida pelo Hélio em 09/11/2026.
 *
 * O WhatsApp pessoal dele é o número normal da Valora (21 93618-6570). Para
 * testar a Val no Oficial fazendo papel de clínica, a Val do OFICIAL pode
 * responder a esse número até o prazo abaixo. A Val do número normal continua
 * travada: como só um dos lados responde, não há robô conversando com robô
 * (o incidente de 09/10/2026).
 *
 * Passado o prazo, a exceção se desliga sozinha. Remover este arquivo depois do
 * teste.
 */
export const TESTE_NO_OFICIAL = {
  numeros: ["5521936186570"],
  ate: new Date("2026-11-10T23:59:59-03:00")
};

export function liberadoParaTesteNoOficial(
  numero: string,
  canal: string | null | undefined,
  agora: Date,
  teste: { numeros: string[]; ate: Date } = TESTE_NO_OFICIAL
): boolean {
  if (canal !== "whatsapp_official") return false;
  if (!(agora.getTime() <= teste.ate.getTime())) return false;
  const variantes = new Set(brNumberVariants(numero));
  return teste.numeros.some(n => brNumberVariants(n).some(v => variantes.has(v)));
}
