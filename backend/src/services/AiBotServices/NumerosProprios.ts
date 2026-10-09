import Whatsapp from "../../models/Whatsapp";
import { getWbot } from "../../libs/wbot";
import { brNumberVariants } from "../../helpers/brPhone";

/**
 * O bot nunca responde a um número que é da PRÓPRIA empresa.
 *
 * Com dois números no mesmo CRM (ex.: o oficial e o por QR Code), um disparo
 * do oficial chega no outro como mensagem de cliente, o bot de lá responde ao
 * oficial, o bot do oficial responde de volta — dois robôs conversando entre
 * si até esgotar a cota. Aconteceu em 09/10/2026 e só parou porque os dois
 * ficaram sem modelo.
 */
export async function ehNumeroDaEmpresa(companyId: number, numero: string): Promise<boolean> {
  const alvo = String(numero || "").replace(/\D/g, "");
  if (!alvo) return false;
  const variantes = new Set(brNumberVariants(alvo));
  variantes.add(alvo);

  const conexoes = await Whatsapp.findAll({
    where: { companyId },
    attributes: ["id", "channel", "cloudApiDisplayNumber"]
  });
  for (const c of conexoes) {
    const proprios: string[] = [];
    if (c.cloudApiDisplayNumber) proprios.push(c.cloudApiDisplayNumber.replace(/\D/g, ""));
    if (c.channel === "whatsapp") {
      try {
        const sessao = getWbot(c.id);
        const jid = sessao?.myJid || sessao?.user?.id || "";
        const digitos = jid.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (digitos) proprios.push(digitos);
      } catch {
        // sessão fora do ar: sem número para comparar
      }
    }
    for (const p of proprios) {
      if (variantes.has(p) || brNumberVariants(p).some(v => variantes.has(v))) return true;
    }
  }
  return false;
}
