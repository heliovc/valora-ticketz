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
import { historicoDoGrupo } from "./ostraBotContext";
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
 * Fluxo: alguém no grupo escreve "Claude, ..." → o Mac do Hélio busca o
 * pedido e gera a resposta com o Claude Code (ver `listarPedidosParaOMac`) →
 * a resposta vai direto para o grupo (só das 8h às 21h; fora disso, às 8h).
 * Com `OSTRA_BOT_APROVACAO=true`, vira rascunho no chat do Hélio consigo
 * mesmo: "ok <id>" posta, "não <id>" descarta, "editar <id> <texto>" troca.
 *
 * Mensagens do próprio Hélio no grupo também disparam (pedido dele em
 * 21/10/2026). O laço é evitado pelo prefixo: o que o bot posta começa com
 * "🤖", nunca com "Claude".
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

/**
 * Aprovação do Hélio antes de postar. Desligada por padrão desde 22/10/2026,
 * a pedido dele ("assistente autônomo"). `OSTRA_BOT_APROVACAO=true` volta ao
 * fluxo de rascunho + "ok <id>" sem mexer em código.
 */
const aprovacaoLigada = (): boolean =>
  (process.env.OSTRA_BOT_APROVACAO || "").trim().toLowerCase() === "true";

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
  cfg: Config,
  autor: string,
  pergunta: string
): Promise<void> => {
  try {
    const draft = await OstraBotDraft.create({
      groupJid: cfg.groupJid,
      mensagemId: msg.key.id,
      pergunta,
      autor,
      autorJid: msg.key.participant || null,
      status: "GERANDO"
    } as Partial<OstraBotDraft> as OstraBotDraft);
    logger.info({ draftId: draft.id, autor }, "[ostraBot] pedido recebido");
  } catch (err) {
    // A mesma mensagem chegou duas vezes: o primeiro rascunho vale.
    if (!ehDuplicada(err)) throw err;
  }
};

/**
 * Quem escreve o rascunho é o Claude Code no Mac do Hélio (plano Max, sem
 * chave de API). O Mac pergunta aqui o que há para fazer. Cada pedido é
 * "pego" por 5 minutos: se o Mac cair no meio, o pedido volta para a fila.
 */
const PRAZO_DO_MAC_MS = 5 * 60 * 1000;
/** Pedido parado há mais que isso sem o Mac buscar: avisa o Hélio uma vez. */
const AVISO_MAC_PARADO_MS = 3 * 60 * 1000;

export type PedidoParaOMac = {
  id: number;
  autor: string;
  pergunta: string;
  pedidoEm: string;
  historico: string;
};

export const listarPedidosParaOMac = async (): Promise<PedidoParaOMac[]> => {
  const cfg = configDoBot();
  if (!cfg) return [];
  const agora = new Date();
  const candidatos = await OstraBotDraft.findAll({
    where: {
      status: "GERANDO",
      [Op.or]: [
        { pegoEm: null },
        { pegoEm: { [Op.lt]: new Date(agora.getTime() - PRAZO_DO_MAC_MS) } }
      ]
    },
    order: [["id", "ASC"]],
    limit: 3
  });

  const pedidos = await Promise.all(
    candidatos.map(async draft => {
      const [pegou] = await OstraBotDraft.update(
        { pegoEm: agora },
        {
          where: {
            id: draft.id,
            status: "GERANDO",
            pegoEm: draft.pegoEm || null
          }
        }
      );
      if (!pegou) return null;
      return {
        id: draft.id,
        autor: draft.autor,
        pergunta: draft.pergunta,
        pedidoEm: draft.criadoEm.toISOString(),
        historico: await historicoDoGrupo(cfg.groupJid, draft.criadoEm)
      };
    })
  );
  return pedidos.filter(Boolean);
};

/** O Mac devolve o texto (ou o motivo de não ter conseguido). */
export const receberRascunhoDoMac = async (
  id: number,
  resultado: { texto?: string; erro?: string }
): Promise<"ok" | "ignorado"> => {
  const cfg = configDoBot();
  if (!cfg) return "ignorado";
  const draft = await OstraBotDraft.findByPk(id);
  if (!draft || draft.status !== "GERANDO") return "ignorado";

  const wbot = getWbot(cfg.whatsappId);
  const texto = (resultado.texto || "").trim();
  if (!texto) {
    const motivo = String(resultado.erro || "resposta vazia").slice(0, 300);
    await draft.update({ status: "ERRO", erro: `geração: ${motivo}` });
    logger.error({ draftId: id, err: motivo }, "[ostraBot] Mac não gerou");
    await avisarHelio(
      wbot,
      `#${id} Pedido de ${draft.autor}: "${draft.pergunta}"\nNão consegui gerar a resposta (${motivo}). Nada foi postado.`
    );
    return "ok";
  }

  const agora = new Date();

  if (aprovacaoLigada()) {
    await draft.update({
      rascunho: formatarParaOGrupo(texto),
      status: "PENDENTE",
      expiraEm: prazoDoRascunho(agora)
    });
    await avisarHelio(
      wbot,
      formatarRascunhoParaOHelio({
        id,
        autor: draft.autor,
        pergunta: draft.pergunta,
        rascunho: draft.rascunho,
        foraDoHorario: !dentroDoHorario(agora)
      })
    );
    return "ok";
  }

  // Autônomo: já nasce aprovado. Dentro do horário sai agora; fora dele o
  // tick das 8h solta, na ordem dos pedidos.
  await draft.update({
    rascunho: formatarParaOGrupo(texto),
    status: "APROVADO",
    aprovadoEm: agora
  });
  if (dentroDoHorario(agora)) {
    await enviarNoGrupo(id, cfg);
  }
  return "ok";
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
    // No modo autônomo o Hélio vê a resposta no próprio grupo.
    if (aprovacaoLigada()) {
      await avisarHelio(wbot, `#${draftId} enviado no grupo.`);
    }
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
        recente &&
        !(texto || "").startsWith(PREFIXO_GRUPO.trim())
      ) {
        criarRascunho(msg, cfg, autor, pergunta).catch(err => {
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

  // Pedido que esperou o Mac por um dia inteiro já perdeu o sentido.
  await OstraBotDraft.update(
    { status: "EXPIRADO", erro: "Mac não buscou o pedido em 24h" },
    {
      where: {
        status: "GERANDO",
        criadoEm: { [Op.lt]: new Date(agora.getTime() - 24 * 60 * 60 * 1000) }
      }
    }
  );

  const parados = await OstraBotDraft.findAll({
    where: {
      status: "GERANDO",
      pegoEm: null,
      avisadoMac: false,
      criadoEm: { [Op.lt]: new Date(agora.getTime() - AVISO_MAC_PARADO_MS) }
    }
  });
  await parados.reduce(async (anterior, draft) => {
    await anterior;
    await draft.update({ avisadoMac: true });
    try {
      await avisarHelio(
        getWbot(cfg.whatsappId),
        `#${draft.id} Pedido de ${draft.autor}: "${draft.pergunta}"\nEstá esperando o seu Mac ligado para eu escrever a resposta.`
      );
    } catch {
      // conexão fora: o pedido segue na fila
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
