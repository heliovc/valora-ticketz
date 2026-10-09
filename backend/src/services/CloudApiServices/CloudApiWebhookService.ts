import * as Sentry from "@sentry/node";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import { GetCompanySetting } from "../../helpers/CheckSettings";
import { hmacSha256Hex, safeEqualBuffers } from "../../helpers/cloudApiCrypto";
import { generateBotReply } from "../../helpers/aiBot";
import { provedoresDaEmpresa } from "../AiBotServices/AiBotProvidersService";
import { agruparRajada, separarTurnoAtual } from "../../helpers/aiBotTurn";
import { ListAiBotFileTextsService } from "../AiBotFileServices/AiBotFileService";
import { botDeveResponder } from "../TagServices/funnelActionRules";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import { FindOrCreateTicketServiceMetaComEstado } from "../TicketServices/FindOrCreateTicketServiceMeta";
import { agendarAcoesDoFunil } from "../../queues/funnelAutomation";
import { focoDoBot } from "../AiBotServices/FocoDoBotService";
import { passarParaHumano } from "../AiBotServices/PassarParaHumano";
import { contextoDeAcoes, executarAcoesDoBot, limparMarcadores } from "../AiBotServices/AcoesDoBot";
import {
  AVISO_ACIMA_DO_SIMPLES,
  extrairPedidoDeSimulacao,
  prepararSimulacao
} from "../AiBotServices/SimulacaoNoBot";
import {
  atualizarPorStatus,
  ultimoDisparoRecebido
} from "./CloudApiBroadcastService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import {
  CHANNEL,
  numberWhereClause,
  resolveConnectionByPhoneNumberId
} from "./CloudApiChannel";
import { sendImage, sendText } from "./CloudApiSendService";
import { extrairAtribuicao } from "../../helpers/adReferral";

/**
 * Recebimento do WhatsApp Oficial (Meta Cloud API).
 *
 * A Meta entrega tudo por um webhook só — um App tem UMA URL para todas as
 * contas inscritas nele. Por isso o roteamento é sempre por
 * `value.metadata.phone_number_id`, e nunca por variável de ambiente: é o que
 * faz este mesmo código atender um número (hoje) ou mil (quando cada lojista
 * conectar o dele).
 */

const HISTORY_LIMIT = 12;

/**
 * Confere a assinatura `X-Hub-Signature-256`.
 *
 * Sem isto, qualquer um que descubra a URL injeta mensagem falsa em qualquer
 * conversa de qualquer empresa. O webhook que o Ticketz original tinha (e
 * deletou em 2025) NÃO validava assinatura — é o erro a não repetir.
 *
 * Se `META_APP_SECRET` não estiver configurado, recusa tudo. Degradar para
 * "aceita sem assinatura" seria transformar uma falha de configuração num
 * buraco aberto.
 */
export function assinaturaValida(
  rawBody: Buffer | undefined,
  header: string | undefined
): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    logger.error(
      "CloudApi: META_APP_SECRET não configurado — webhook recusado por segurança"
    );
    return false;
  }
  if (!rawBody || !header) return false;

  const esperado = `sha256=${hmacSha256Hex(secret, rawBody)}`;
  return safeEqualBuffers(
    Buffer.from(esperado, "utf8"),
    Buffer.from(header, "utf8")
  );
}

/** Extrai texto legível de qualquer tipo de mensagem que a Meta entregue. */
function extrairTexto(msg: any): { body: string; mediaType?: string } {
  switch (msg?.type) {
    case "text":
      return { body: msg.text?.body || "" };
    case "button":
      return { body: msg.button?.text || "" };
    case "interactive":
      return {
        body:
          msg.interactive?.button_reply?.title ||
          msg.interactive?.list_reply?.title ||
          ""
      };
    case "location": {
      const l = msg.location || {};
      const nome = l.name || l.address || "";
      return {
        body: `📍 Localização${nome ? `: ${nome}` : ""} (${l.latitude}, ${l.longitude})`
      };
    }
    case "contacts":
      return { body: "👤 Contato recebido" };
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      // Baixar a mídia é um passo a mais (URL assinada da Graph) e fica para a
      // próxima entrega. Aqui o atendente pelo menos SABE que algo chegou, em
      // vez de ver a conversa pular sem explicação.
      return {
        body:
          msg[msg.type]?.caption ||
          `📎 ${msg.type === "image" ? "Imagem" : msg.type === "audio" ? "Áudio" : msg.type === "video" ? "Vídeo" : msg.type === "sticker" ? "Figurinha" : "Documento"} recebido — abra no celular para ver`,
        mediaType: msg.type
      };
    case "unsupported":
      return { body: "Mensagem de um tipo que o WhatsApp não repassa." };
    default:
      return { body: "" };
  }
}

/** Histórico recente para o bot, do mais antigo ao mais novo. */
async function mensagensRecentes(ticketId: number): Promise<Message[]> {
  const rows = await Message.findAll({
    where: { ticketId },
    order: [["createdAt", "DESC"]],
    limit: HISTORY_LIMIT
  });
  return rows.reverse();
}

/**
 * Acha ou cria o contato, tolerando o nono dígito.
 *
 * A Meta manda o número do Brasil muitas vezes SEM o 9; o Baileys grava COM.
 * Como `Contact.number` é único, procurar só a forma exata criaria um segundo
 * contato para a mesma pessoa — ou estouraria a constraint dentro do webhook.
 */
async function acharOuCriarContato(
  companyId: number,
  numeroDaMeta: string,
  nomePerfil: string
): Promise<Contact> {
  const existente = await Contact.findOne({
    where: { companyId, ...numberWhereClause(numeroDaMeta) } as any
  });

  return CreateOrUpdateContactService({
    // Reusa o número já gravado, para não duplicar o contato.
    number: existente ? existente.number : numeroDaMeta.replace(/\D/g, ""),
    name: nomePerfil || existente?.name || numeroDaMeta,
    isGroup: false,
    companyId,
    channel: CHANNEL
  } as any);
}

/** Uma mensagem recebida. */
async function processarMensagem(
  whatsapp: Whatsapp,
  value: any,
  msg: any
): Promise<void> {
  const wamid: string = msg?.id;
  if (!wamid) return;

  // Idempotência: a Meta reentrega o mesmo evento quando desconfia que não
  // chegou (e reentrega mesmo). `Message.id` é a chave primária e é string,
  // então o próprio wamid resolve — mas `upsert` reemitiria o websocket e a
  // mensagem piscaria de novo na tela. Daí o corte antes.
  const jaExiste = await Message.findByPk(wamid);
  if (jaExiste) {
    logger.debug({ wamid }, "CloudApi: evento repetido, ignorado");
    return;
  }

  const { companyId } = whatsapp;
  const { body, mediaType } = extrairTexto(msg);
  if (!body) return;

  const nomePerfil = value?.contacts?.[0]?.profile?.name || "";
  const contact = await acharOuCriarContato(companyId, msg.from, nomePerfil);

  const { ticket, criada } = await FindOrCreateTicketServiceMetaComEstado(
    contact,
    whatsapp.id,
    1,
    companyId,
    CHANNEL
  );

  // Resposta a um disparo: o card nasce mostrando o que foi enviado, senão o
  // atendente lê "sim" sem saber a que o cliente disse sim.
  if (criada) {
    try {
      const recebido = await ultimoDisparoRecebido(companyId, whatsapp.id, msg.from);
      if (recebido?.text) {
        await CreateMessageService({
          messageData: {
            id: `disparo-${recebido.id}-${ticket.id}`,
            ticketId: ticket.id,
            contactId: contact.id,
            body: `📣 Disparo "${(recebido as any).broadcast?.name || ""}":\n${recebido.text}`,
            fromMe: true,
            read: true,
            ack: 2,
            channel: CHANNEL
          },
          companyId
        });
      }
    } catch (err: any) {
      logger.debug({ message: err?.message }, "CloudApi: sem contexto de disparo");
    }
  }

  await CreateMessageService({
    messageData: {
      id: wamid,
      ticketId: ticket.id,
      contactId: contact.id,
      body,
      fromMe: false,
      read: false,
      ...(mediaType ? { mediaType } : {}),
      channel: CHANNEL
    },
    companyId
  });

  // Abre (ou renova) a janela de 24h. Sem esta marca não há como saber, na hora
  // de responder, se a Meta vai aceitar texto livre.
  const atualizacao: Record<string, unknown> = { lastInboundAt: new Date() };

  // Atribuição de anúncio: grava sempre que vier, inclusive numa conversa que
  // já existia. Se a pessoa clicou num anúncio novo agora, é esse anúncio que
  // trouxe ela desta vez — é o que o atendente precisa ver no cabeçalho.
  const atribuicao = extrairAtribuicao(msg);
  if (atribuicao) {
    Object.assign(atualizacao, atribuicao);
    logger.info(
      {
        ticketId: ticket.id,
        anuncio: atribuicao.referralSourceId,
        tipo: atribuicao.referralSourceType
      },
      "CloudApi: conversa veio de anúncio"
    );
  }

  await ticket.update(atualizacao);

  // Automações de conversa nova — as do quadro desta conexão. Depois da marca
  // da janela: uma mensagem automática precisa saber que a conversa aceita
  // texto livre. Aguardado para o "ligar bot" valer já para esta mensagem.
  if (criada) {
    await agendarAcoesDoFunil(ticket.id, null, companyId);
    await ticket.reload();
  }

  // A resposta espera o cliente parar de digitar: várias mensagens seguidas
  // recebem uma resposta só, montada do banco quando a rajada termina.
  agruparRajada(ticket.id, () =>
    responderComBot(whatsapp, ticket.id, contact)
  );
}

/**
 * Resposta automática do bot de IA — mesmo comportamento do Chat do Site.
 *
 * O canal oficial NÃO tem, nesta entrega, a máquina de saudação/fila/opções do
 * Baileys: ela vive dentro do listener do Baileys e replicá-la é outro projeto.
 * Aqui é bot de IA ou atendimento humano, como no webchat.
 */
async function responderComBot(
  whatsapp: Whatsapp,
  ticketId: number,
  contact: Contact
): Promise<void> {
  const { companyId } = whatsapp;
  // Estado de agora, não o de quando a mensagem chegou: durante a espera um
  // atendente pode ter assumido ou o funil desligado o bot.
  const ticket = await Ticket.findByPk(ticketId);
  if (!ticket) return;
  const daEmpresa =
    (await GetCompanySetting(companyId, "aiBotEnabled", "disabled")) === "enabled";

  if (!botDeveResponder(ticket.aiBotEnabled, daEmpresa)) return;
  // Só os modelos DESTA empresa: sem modelo configurado, o bot não responde.
  const provedores = await provedoresDaEmpresa(companyId);
  if (!provedores.length) return;
  // Humano assumiu a conversa: o bot sai de cena.
  if (ticket.userId) return;

  try {
    const { history, pendente } = separarTurnoAtual(
      await mensagensRecentes(ticketId)
    );
    if (!pendente) return;

    const persona = await GetCompanySetting(companyId, "aiBotPersona", "");
    const knowledge = await GetCompanySetting(companyId, "aiBotKnowledge", "");
    const files = await ListAiBotFileTextsService(companyId);
    const foco = await focoDoBot(ticketId, companyId);
    const resposta = await generateBotReply({
      persona,
      knowledge,
      history,
      userMessage: pendente,
      contactName: contact.name,
      files,
      foco,
      acoes: await contextoDeAcoes(ticketId, companyId),
      provedores
    });

    if (!resposta || !resposta.text.trim()) return;

    // O bot pode pedir a simulação de taxas no meio da resposta: o marcador sai
    // do texto e a imagem é gerada e enviada aqui, com os números da conta.
    // Comandos MOVER/SALVAR executam e saem do texto; o SIMULAR vem depois.
    const semAcoes = await executarAcoesDoBot(ticket.id, companyId, resposta.text.trim());
    const extraido = extrairPedidoDeSimulacao(semAcoes);
    const antes = limparMarcadores(extraido.antes);
    const depois = limparMarcadores(extraido.depois);
    const { pedido } = extraido;
    const enviarTexto = async (corpo: string) => {
      const { wamid } = await sendText(whatsapp, contact.number, corpo);
      await CreateMessageService({
        messageData: {
          id: wamid,
          ticketId: ticket.id,
          contactId: contact.id,
          body: corpo,
          fromMe: true,
          read: true,
          ack: 1,
          channel: CHANNEL
        },
        companyId
      });
    };
    if (antes) await enviarTexto(antes);
    if (pedido) {
      const pronta = await prepararSimulacao(companyId, ticket.id, pedido);
      const enviado = pronta
        ? await sendImage(whatsapp, contact.number, pronta.imagem, pronta.legenda)
        : await sendText(whatsapp, contact.number, AVISO_ACIMA_DO_SIMPLES);
      await CreateMessageService({
        messageData: {
          id: enviado.wamid,
          ticketId: ticket.id,
          contactId: contact.id,
          body: pronta ? pronta.legenda : AVISO_ACIMA_DO_SIMPLES,
          fromMe: true,
          read: true,
          ack: 1,
          channel: CHANNEL,
          ...(pronta ? { mediaType: "image", mediaUrl: pronta.arquivo } : {})
        },
        companyId
      });
    }
    if (depois) await enviarTexto(depois);
    if (resposta.kind === "handoff" && !resposta.falha) await passarParaHumano(ticket.id, companyId);
  } catch (err: any) {
    // Bot que falha deixa a conversa para o humano — nunca derruba o webhook.
    Sentry.captureException(err);
    logger.error(
      { ticketId: ticket.id, message: err?.message },
      "CloudApi: bot de IA não respondeu"
    );
  }
}

/**
 * Confirmações de entrega/leitura.
 *
 * Mesma regra do Baileys (`handleMsgAck`): status chegam fora de ordem com
 * frequência, então um ack menor nunca sobrescreve um maior. A função original
 * não é exportada e vive num arquivo de 2200 linhas acoplado ao Baileys —
 * replicar as poucas linhas custa menos que mexer lá.
 */
/** O erro de entrega da Meta, em português e com o que fazer. */
function motivoDaFalha(erro: any): string {
  const codigo = Number(erro?.code);
  if (codigo === 131026) {
    return "Não entregue: o número não tem WhatsApp ou não pode receber mensagens de empresas.";
  }
  if (codigo === 131049) {
    return "Não entregue: a Meta segurou a mensagem de marketing porque este número já recebeu muitas recentemente. Tente outro dia.";
  }
  if (codigo === 131047) {
    return "Não entregue: passaram 24h desde a última mensagem do cliente — só modelo aprovado.";
  }
  if (codigo === 131050) {
    return "Não entregue: o cliente parou de receber mensagens de marketing desta empresa.";
  }
  if (codigo === 131031 || codigo === 131042) {
    return "Não entregue: a conta do WhatsApp da empresa está bloqueada ou com pagamento pendente na Meta.";
  }
  const titulo = erro?.title || erro?.message;
  return titulo ? `Não entregue (${codigo || "?"}): ${titulo}` : "Não entregue pela Meta.";
}

async function processarStatus(whatsapp: Whatsapp, status: any): Promise<void> {
  const mapa: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
  const ack = mapa[status?.status];

  // Destinatário de disparo em massa: atualiza entregue/lido/falhou.
  await atualizarPorStatus(
    whatsapp.companyId,
    status?.id,
    status?.status,
    status?.errors?.[0]?.title || status?.errors?.[0]?.message
  ).catch(err =>
    logger.debug({ message: err?.message }, "CloudApi: status de disparo ignorado")
  );

  if (status?.status === "failed") {
    // A falha vira estado da mensagem, com o motivo em português: antes ela
    // ficava "enviada" para sempre e o atendente nunca sabia.
    const falha = await Message.findByPk(status?.id);
    if (falha && falha.companyId === whatsapp.companyId) {
      await falha.update({
        ack: -1,
        deliveryError: motivoDaFalha(status?.errors?.[0])
      } as any);
      getIO()
        .to(falha.ticketId.toString())
        .emit(`company-${falha.companyId}-appMessage`, {
          action: "update",
          message: falha
        });
    }
    logger.warn(
      {
        wamid: status?.id,
        erros: status?.errors,
        phoneNumberId: whatsapp.cloudApiPhoneNumberId
      },
      "CloudApi: a Meta recusou a entrega desta mensagem"
    );
    return;
  }
  if (!ack || !status?.id) return;

  const message = await Message.findByPk(status.id);
  // Falha é definitiva: um "sent" atrasado não pode apagá-la.
  if (!message || message.ack === -1 || ack <= message.ack) return;

  await message.update({ ack });
  getIO()
    .to(message.ticketId.toString())
    .emit(`company-${message.companyId}-appMessage`, {
      action: "update",
      message
    });
}

/**
 * Ponto de entrada do webhook.
 *
 * NUNCA lança: o controller já respondeu 200 à Meta antes de chamar isto. Erro
 * aqui é log, não repetição — devolver não-200 faria a Meta reenviar tudo em
 * backoff e multiplicar o trabalho.
 */
export async function processarEvento(payload: any): Promise<void> {
  try {
    if (payload?.object !== "whatsapp_business_account") {
      logger.debug({ object: payload?.object }, "CloudApi: evento ignorado");
      return;
    }

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== "messages") {
          // `message_template_status_update` e `phone_number_quality_update`
          // passam por aqui. Ainda não tratados — mas registrados, porque é
          // por eles que se descobre template reprovado e qualidade caindo.
          logger.info(
            { field: change.field, value: change.value },
            "CloudApi: evento não tratado nesta versão"
          );
          continue;
        }

        const value = change.value || {};
        const phoneNumberId = value?.metadata?.phone_number_id;
        const whatsapp = await resolveConnectionByPhoneNumberId(phoneNumberId);

        if (!whatsapp) {
          logger.warn(
            { phoneNumberId },
            "CloudApi: chegou mensagem de um número que não está configurado aqui"
          );
          continue;
        }

        for (const msg of value.messages || []) {
          await processarMensagem(whatsapp, value, msg);
        }
        for (const status of value.statuses || []) {
          await processarStatus(whatsapp, status);
        }
      }
    }
  } catch (err: any) {
    Sentry.captureException(err);
    logger.error(
      { message: err?.message, stack: err?.stack },
      "CloudApi: falha ao processar evento do webhook"
    );
  }
}
