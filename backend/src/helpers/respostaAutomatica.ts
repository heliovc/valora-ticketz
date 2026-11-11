/**
 * Resposta automática da casa: boas-vindas, menu, horário de atendimento,
 * "deixe sua mensagem". Quem só respondeu assim nunca falou com a gente.
 *
 * Caso real (11/11/2026): Sapekids, Algazarra Kids e Sítio Vila Verde
 * receberam 2 ou 3 follow-ups da Val, mas do outro lado só havia o robô da
 * casa. A playbook manda responder ao robô uma vez e esperar uma pessoa.
 *
 * Regra conservadora: a mensagem do contato só conta como robô quando chegou
 * logo depois de uma nossa E tem cara de mensagem automática. Na dúvida, é
 * gente (o follow-up sai).
 */
export interface MensagemDaConversa {
  fromMe: boolean;
  body: string | null;
  createdAt: Date | string;
}

/** Robô responde em segundos; o mais lento visto foi 43 s (Sítio Vila Verde). */
export const SEGUNDOS_DE_ROBO = 90;

const PADRAO = new RegExp(
  [
    "sejam? (muito )?bem vind[oa]s?",
    "bem vind[oa]s? (a|ao|as|aos) ",
    "agradece(mos)? (o )?(seu )?contato",
    "obrigad[oa] (pelo|por) (seu )?contato",
    "horario de atendimento",
    "nosso horario",
    "fora do (nosso )?horario",
    "atendimento (de|da) (segunda|terca|quarta|quinta|sexta)",
    "deixe (a )?sua mensagem",
    "em breve (retornaremos|responderemos|entraremos|entrarei|retornarei)",
    "retornaremos (o contato|em breve|assim que)",
    "responderemos (assim que|em breve|o mais)",
    "digite (o numero|uma das|a opcao|apenas)",
    "escolha (uma das )?(opcoes|opcao)",
    "(opcao|resposta) (invalida|nao (e )?valida)",
    "nao (consegui|entendi|identifiquei|foi possivel) (identificar|entender|encontrar|sua|a opcao)",
    "responda (apenas )?com",
    "selecione",
    "preencha (esse|este|o) (breve )?formulario",
    "assistente virtual",
    "atendimento (automatico|automatizado)",
    "mensagem automatica"
  ].join("|")
);

/** Minúsculas, sem acento, emoji nem pontuação. */
function normalizar(texto: string | null | undefined): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function pareceRespostaAutomatica(texto: string | null | undefined): boolean {
  return PADRAO.test(` ${normalizar(texto)} `);
}

/**
 * Do outro lado só houve resposta automática? Cada mensagem do contato chegou
 * até `SEGUNDOS_DE_ROBO` depois de uma nossa e tem cara de robô. Sem mensagem
 * do contato, `false`: quem nunca respondeu não é assunto deste filtro.
 */
export function soRespostaAutomatica(mensagens: MensagemDaConversa[]): boolean {
  const ordenadas = [...mensagens].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let ultimaNossa: number | null = null;
  let doContato = 0;
  for (const m of ordenadas) {
    const quando = new Date(m.createdAt).getTime();
    if (m.fromMe) {
      ultimaNossa = quando;
      continue;
    }
    if (!String(m.body || "").trim()) continue;
    doContato += 1;
    const rapida = ultimaNossa !== null && quando - ultimaNossa <= SEGUNDOS_DE_ROBO * 1000;
    if (!rapida || !pareceRespostaAutomatica(m.body)) return false;
  }
  return doContato > 0;
}
