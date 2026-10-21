import {
  extractMessageContent,
  getContentType,
  jidNormalizedUser,
  proto
} from "libzapitu-rf";
import { Op } from "sequelize";
import * as Sentry from "@sentry/node";
import OstraBotDraft from "../../models/OstraBotDraft";
import OstraBotMessage from "../../models/OstraBotMessage";
import { getWbot, Session } from "../../libs/wbot";
import { logger } from "../../utils/logger";
import { gerarResposta } from "./ostraBotContext";
import {
  ComandoDoHelio,
  dentroDoHorario,
  descreverMidia,
  extrairPergunta,
  formatarParaOGrupo,
  formatarRascunhoParaOHelio,
  interpretarComando,
  MARCA_DO_BOT,
  PREFIXO_GRUPO,
  prazoDoRascunho
} from "./ostraBotRules";

/**
 * Assistente "Claude" do grupo Ostra Carioca.
 *
 * Fluxo: alguém no grupo escreve "Claude, ..." → o modelo gera um rascunho →
 * o rascunho vai para o chat do Hélio com ele mesmo → "ok <id>" posta no
 * grupo (só das 8h às 21h), "não <id>" descarta, "editar <id> <texto>" troca.
 *
 * Isolamento: só age com `OSTRA_BOT_ENABLED=true`, só na conexão
 * `OSTRA_BOT_WHATSAPP_ID` e só no grupo `OSTRA_GROUP_JID`. Mensagens do grupo
 * seguem para o Ticketz exatamente como antes (o hook devolve `false`); o
 * único consumo é o dos comandos e avisos no chat do Hélio consigo mesmo.
 *
 * Nunca reenvia: o status vira ENVIANDO antes de chamar o WhatsApp. Se o envio
 * falhar, vira ERRO e o Hélio é avisado; nada tenta de novo.
 */

/** Pedido mais velho que isso é replay de sincronismo, não pergunta nova. */
const IDADE_MAX_GATILHO_MS = 10 * 60 * 1000;

type Config = { whatsappId: number; groupJid: string; dono: string };

/** Lido a cada mensagem: o kill switch vale assim que o container reinicia. */
export const configDoBot = (): Config | null => {
  if ((process.env.OSTRA_BOT_ENABLED || "").trim().toLowerCase() !== "true") {
    return null;
  }
  const whatsappId = Number(process.env.OSTRA_BOT_WHATSAPP_ID);
  const groupJid = (process.env.OSTRA_GROUP_JID || "").trim();
  if (!whatsappId || !groupJid.endsWith("@g.us")) return null;
  return {
    whatsappId,
    groupJid,
    dono: process.env.OSTRA_BOT_DONO_NOME || "Hélio"
  };
};

const IGNORAR = [
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "messageContextInfo",
  "pollUpdateMessage"
];

/** Texto da mensagem e como ela entra no histórico. */
const lerMensagem = (
  msg: proto.IWebMessageInfo
): { texto: string | null; historico: string | null } => {
  const conteudo = extractMessageContent(msg.message);
  const tipo = conteudo ? getContentType(conteudo) : undefined;
  if (!conteudo || !tipo || IGNORAR.includes(tipo)) {
    return { texto: null, historico: null };
  }
  if (tipo === "conversation") {
    return { texto: conteudo.conversation, historico: conteudo.conversation };
  }
  if (tipo === "extendedTextMessage") {
    const t = conteudo.extendedTextMessage?.text || "";
    return { texto: t, historico: t };
  }
  const midia = ((conteudo as Record<string, unknown>)[tipo] || {}) as {
    fileName?: string;
    title?: string;
    caption?: string;
  };
  return {
    texto: null,
    historico: descreverMidia({
      tipo,
      nomeArquivo: midia.fileName || midia.title,
      legenda: midia.caption
    })
  };
};

const ehChatComigoMesmo = (jid: string, wbot: Session): boolean => {
  const normal = jidNormalizedUser(jid);
  return (
    (!!wbot.myJid && normal === wbot.myJid) ||
    (!!wbot.myLid && normal === wbot.myLid)
  );
};

const momentoDa = (msg: proto.IWebMessageInfo): Date => {
  const ts = Number(msg.messageTimestamp || 0);
  return ts ? new Date(ts * 1000) : new Date();
};

const ehDuplicada = (err: { name?: string }) =>
  err?.name === "SequelizeUniqueConstraintError";

/** Escreve no chat do Hélio com ele mesmo. Falha aqui só vai para o log. */
const avisarHelio = async (wbot: Session, texto: string): Promise<void> => {
  try {
    if (!wbot.myJid) throw new Error("número próprio desconhecido");
    await wbot.sendMessage(wbot.myJid, { text: `${MARCA_DO_BOT}${texto}` });
  } catch (err) {
    logger.error({ err: err?.message }, "[ostraBot] falha ao avisar o Hélio");
  }
};

const registrarNoHistorico = async (
  msg: proto.IWebMessageInfo,
  cfg: Config,
  autor: string,
  historico: string
) => {
  try {
    await OstraBotMessage.create({
      groupJid: cfg.groupJid,
      mensagemId: msg.key.id,
      autor,
      texto: historico,
      enviadaEm: momentoDa(msg)
    } as Partial<OstraBotMessage> as OstraBotMessage);
  } catch (err) {
    if (!ehDuplicada(err)) {
      logger.warn({ err: err?.message }, "[ostraBot] histórico não gravado");
    }
  }
};

const criarRascunho = async (
  msg: proto.IWebMessageInfo,
  wbot: Session,
  cfg: Config,
  autor: string,
  pergunta: string
): Promise<void> => {
  let draft: OstraBotDraft;
  try {
    draft = await OstraBotDraft.create({
      groupJid: cfg.groupJid,
      mensagemId: msg.key.id,
      pergunta,
      autor,
      autorJid: msg.key.participant || null,
      status: "GERANDO"
    } as Partial<OstraBotDraft> as OstraBotDraft);
  } catch (err) {
    // A mesma mensagem chegou duas vezes: o primeiro rascunho vale.
    if (ehDuplicada(err)) return;
    throw err;
  }

  logger.info({ draftId: draft.id, autor }, "[ostraBot] pedido recebido");

  try {
    const texto = await gerarResposta({
      groupJid: cfg.groupJid,
      autor,
      pergunta,
      pedidoEm: momentoDa(msg)
    });
    const agora = new Date();
    await draft.update({
      rascunho: formatarParaOGrupo(texto),
      status: "PENDENTE",
      expiraEm: prazoDoRascunho(agora)
    });
    await avisarHelio(
      wbot,
      formatarRascunhoParaOHelio({
        id: draft.id,
        autor,
        pergunta,
        rascunho: draft.rascunho,
        foraDoHorario: !dentroDoHorario(agora)
      })
    );
  } catch (err) {
    Sentry.captureException(err);
    const motivo = String(err?.message || err).slice(0, 300);
    await draft.update({ status: "ERRO", erro: `geração: ${motivo}` });
    logger.error(
      { draftId: draft.id, err: motivo },
      "[ostraBot] falha ao gerar"
    );
    await avisarHelio(
      wbot,
      `#${draft.id} Pedido de ${autor}: "${pergunta}"\nNão consegui gerar a resposta (${motivo}). Nada foi postado.`
    );
  }
};

/**
 * Posta o rascunho no grupo. Uma única tentativa: quem chega aqui depois de
 * outro processo já ter trocado o status para ENVIANDO simplesmente sai.
 */
const enviarNoGrupo = async (draftId: number, cfg: Config): Promise<void> => {
  const [travou] = await OstraBotDraft.update(
    { status: "ENVIANDO" },
    { where: { id: draftId, status: { [Op.in]: ["PENDENTE", "APROVADO"] } } }
  );
  if (!travou) return;

  const draft = await OstraBotDraft.findByPk(draftId);
  let wbot: Session;
  try {
    wbot = getWbot(cfg.whatsappId);
    await wbot.sendMessage(cfg.groupJid, { text: draft.rascunho });
    await draft.update({ status: "ENVIADO", enviadoEm: new Date() });
    logger.info({ draftId }, "[ostraBot] enviado no grupo");
    await avisarHelio(wbot, `#${draftId} enviado no grupo.`);
  } catch (err) {
    Sentry.captureException(err);
    const motivo = String(err?.message || err).slice(0, 300);
    await draft.update({ status: "ERRO", erro: `envio: ${motivo}` });
    logger.error(
      { draftId, err: motivo },
      "[ostraBot] falha ao enviar no grupo"
    );
    if (wbot) {
      await avisarHelio(
        wbot,
        `#${draftId} NÃO foi enviado no grupo (${motivo}). Não vou tentar de novo.`
      );
    }
  }
};

const responderComando = async (
  cmd: ComandoDoHelio,
  wbot: Session,
  cfg: Config
): Promise<void> => {
  const draft = await OstraBotDraft.findByPk(cmd.id);
  if (!draft) {
    await avisarHelio(wbot, `#${cmd.id} não existe.`);
    return;
  }

  const agora = new Date();
  if (
    draft.status === "PENDENTE" &&
    draft.expiraEm &&
    draft.expiraEm.getTime() < agora.getTime()
  ) {
    await draft.update({ status: "EXPIRADO" });
  }

  const aberto =
    draft.status === "PENDENTE" ||
    (cmd.tipo === "nao" && draft.status === "APROVADO");
  if (!aberto) {
    await avisarHelio(
      wbot,
      `#${draft.id} não está mais aguardando você (status: ${draft.status.toLowerCase()}).`
    );
    return;
  }

  if (cmd.tipo === "nao") {
    await draft.update({ status: "DESCARTADO" });
    await avisarHelio(wbot, `#${draft.id} descartado.`);
    return;
  }

  if (cmd.tipo === "editar") {
    await draft.update({
      rascunho: formatarParaOGrupo(cmd.texto),
      expiraEm: prazoDoRascunho(agora)
    });
    await avisarHelio(
      wbot,
      formatarRascunhoParaOHelio({
        id: draft.id,
        autor: draft.autor,
        pergunta: draft.pergunta,
        rascunho: draft.rascunho,
        foraDoHorario: !dentroDoHorario(agora)
      })
    );
    return;
  }

  // ok
  await draft.update({ aprovadoEm: agora });
  if (dentroDoHorario(agora)) {
    await enviarNoGrupo(draft.id, cfg);
    return;
  }
  await draft.update({ status: "APROVADO" });
  await avisarHelio(
    wbot,
    `#${draft.id} aprovado. Fora do horário do grupo: sai às 8h.`
  );
};

const gruposJaLogados = new Set<string>();

/**
 * Modo de descoberta: bot ligado, conexão certa e `OSTRA_GROUP_JID` vazio.
 * Loga uma vez o JID e o nome de cada grupo que falar, para o Hélio copiar o
 * do Ostra Carioca. Não responde nada.
 */
const descobrirGrupo = async (
  msg: proto.IWebMessageInfo,
  wbot: Session
): Promise<void> => {
  const ligado =
    (process.env.OSTRA_BOT_ENABLED || "").trim().toLowerCase() === "true";
  const jid = msg.key?.remoteJid || "";
  if (
    !ligado ||
    (process.env.OSTRA_GROUP_JID || "").trim() ||
    wbot.id !== Number(process.env.OSTRA_BOT_WHATSAPP_ID) ||
    !jid.endsWith("@g.us") ||
    gruposJaLogados.has(jid)
  ) {
    return;
  }
  gruposJaLogados.add(jid);
  try {
    const meta = await wbot.groupMetadata(jid);
    logger.info({ jid, nome: meta.subject }, "[ostraBot] grupo visto");
  } catch {
    logger.info({ jid }, "[ostraBot] grupo visto (sem nome)");
  }
};

/**
 * Chamado no início do tratamento de toda mensagem. Devolve `true` só quando a
 * mensagem era do bot (comando ou aviso no chat do Hélio) e não deve seguir
 * para o Ticketz. Nunca lança.
 */
export const handleOstraBotMessage = async (
  msg: proto.IWebMessageInfo,
  wbot: Session
): Promise<boolean> => {
  try {
    await descobrirGrupo(msg, wbot);
    const cfg = configDoBot();
    if (!cfg || wbot.id !== cfg.whatsappId) return false;

    const remoteJid = msg.key?.remoteJid || "";
    const fromMe = !!msg.key?.fromMe;

    if (remoteJid === cfg.groupJid) {
      const { texto, historico } = lerMensagem(msg);
      if (!historico) return false;

      const autor = fromMe
        ? cfg.dono
        : msg.pushName || (msg.key.participant || "").split("@")[0] || "alguém";
      await registrarNoHistorico(msg, cfg, autor, historico);

      const pergunta = extrairPergunta(texto);
      const recente =
        Date.now() - momentoDa(msg).getTime() < IDADE_MAX_GATILHO_MS;
      if (
        pergunta &&
        !fromMe &&
        recente &&
        !(texto || "").startsWith(PREFIXO_GRUPO.trim())
      ) {
        // Sem await: a geração leva segundos e não pode segurar a fila.
        criarRascunho(msg, wbot, cfg, autor, pergunta).catch(err => {
          Sentry.captureException(err);
          logger.error({ err: err?.message }, "[ostraBot] rascunho falhou");
        });
      }
      return false;
    }

    if (fromMe && ehChatComigoMesmo(remoteJid, wbot)) {
      const { texto } = lerMensagem(msg);
      if (!texto) return false;
      if (texto.startsWith(MARCA_DO_BOT)) return true;
      const cmd = interpretarComando(texto);
      if (!cmd) return false;
      // Comando repetido pelo sincronismo não pode reaprovar nada.
      if (Date.now() - momentoDa(msg).getTime() > IDADE_MAX_GATILHO_MS) {
        return true;
      }
      await responderComando(cmd, wbot, cfg);
      return true;
    }

    return false;
  } catch (err) {
    Sentry.captureException(err);
    logger.error({ err: err?.message }, "[ostraBot] erro no tratamento");
    return false;
  }
};

/** A cada minuto: expira rascunhos sem resposta e solta os aprovados às 8h. */
export const ostraBotTick = async (): Promise<void> => {
  const cfg = configDoBot();
  if (!cfg) return;

  const agora = new Date();
  const vencidos = await OstraBotDraft.findAll({
    where: { status: "PENDENTE", expiraEm: { [Op.lt]: agora } }
  });
  await vencidos.reduce(async (anterior, draft) => {
    await anterior;
    const [mudou] = await OstraBotDraft.update(
      { status: "EXPIRADO" },
      { where: { id: draft.id, status: "PENDENTE" } }
    );
    if (!mudou) return;
    try {
      await avisarHelio(
        getWbot(cfg.whatsappId),
        `#${draft.id} expirou sem resposta. Nada foi postado.`
      );
    } catch {
      // conexão fora: o status já ficou registrado
    }
  }, Promise.resolve());

  if (!dentroDoHorario(agora)) return;
  const aprovados = await OstraBotDraft.findAll({
    where: { status: "APROVADO" },
    order: [["id", "ASC"]]
  });
  // Um de cada vez, na ordem em que foram pedidos.
  await aprovados.reduce(async (anterior, draft) => {
    await anterior;
    await enviarNoGrupo(draft.id, cfg);
  }, Promise.resolve());
};
