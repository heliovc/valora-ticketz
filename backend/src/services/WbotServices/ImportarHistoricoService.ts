import { proto } from "libzapitu-rf";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { getBodyMessage } from "./wbotMessageListener";
import { logger } from "../../utils/logger";

/**
 * Traz para o Kanban as conversas que aconteceram enquanto o CRM estava fora.
 *
 * O problema que isto resolve: quando a conexão cai, o WhatsApp entrega tudo no
 * celular e não guarda nada para o CRM. Ao religar, quem atendeu pelo aparelho
 * tem os leads na mão e o quadro vazio — e é justamente aí que a organização se
 * perde.
 *
 * O WhatsApp só entrega o histórico UMA vez: no instante em que um aparelho é
 * vinculado. Por isso este importador roda no evento de sincronismo do pareamento
 * e não existe um botão "importar agora": não há a quem pedir de novo.
 *
 * 🚨 Escreve DIRETO nas tabelas, de propósito.
 *
 * O caminho normal de uma mensagem que chega dispara resposta automática, robô e
 * automação de funil. Passar o histórico por ali faria o sistema responder
 * sozinho conversas de dias atrás, para leads que já foram atendidos à mão —
 * mandando "olá, tudo bem?" para quem já fechou negócio. Aqui nada é enviado.
 *
 * Nada é apagado nem sobrescrito: mensagem que já existe é pulada pelo id do
 * próprio WhatsApp, e ticket existente é reaproveitado.
 */

/**
 * Janela da importação, em dias. Três por padrão — pedido do Hélio — e ajustável
 * por variável de ambiente.
 *
 * É ajustável porque o tamanho certo depende de QUANDO a conexão caiu, e isso só
 * se descobre depois. Sem a variável, esticar a janela custaria um build novo de
 * quinze minutos com o lead esperando; com ela, é reiniciar o container.
 */
function diasParaTras(): number {
  const bruto = Number(process.env.HISTORICO_DIAS);
  if (!Number.isFinite(bruto) || bruto <= 0) return 3;
  // Teto de 30: acima disso a importação deixa de ser "recuperar uma queda" e
  // vira despejar o WhatsApp inteiro dentro do Kanban.
  return Math.min(Math.floor(bruto), 30);
}

/**
 * Só conversa de pessoa: grupo, status e canal de transmissão ficam de fora.
 *
 * `@lid` entra junto com `@s.whatsapp.net` porque o WhatsApp passou a entregar
 * parte das conversas com um identificador anônimo no lugar do telefone — e é
 * justamente assim que chegam vários leads de anúncio. Deixar o `@lid` de fora
 * faria a importação pular exatamente as conversas que mais importam aqui.
 */
const CONVERSA_DE_PESSOA = /@(s\.whatsapp\.net|lid)$/;

export interface ResumoDaImportacao {
  recebidas: number;
  importadas: number;
  jaExistiam: number;
  foraDaJanela: number;
  ignoradas: number;
  contatosCriados: number;
  ticketsCriados: number;
}

interface HistoricoRecebido {
  messages: proto.IWebMessageInfo[];
}

export async function importarHistorico(
  historico: HistoricoRecebido,
  companyId: number,
  whatsappId: number
): Promise<ResumoDaImportacao> {
  const resumo: ResumoDaImportacao = {
    recebidas: historico.messages?.length ?? 0,
    importadas: 0,
    jaExistiam: 0,
    foraDaJanela: 0,
    ignoradas: 0,
    contatosCriados: 0,
    ticketsCriados: 0
  };
  if (!historico.messages?.length) return resumo;

  const dias = diasParaTras();
  const corte = Math.floor(Date.now() / 1000) - dias * 24 * 60 * 60;

  // Da mais antiga para a mais nova: assim o "última mensagem" do card termina
  // com a mensagem certa, e não com a primeira que o WhatsApp mandou no pacote.
  const emOrdem = [...historico.messages]
    .filter(m => Number(m.messageTimestamp ?? 0) >= corte)
    .sort((a, b) => Number(a.messageTimestamp ?? 0) - Number(b.messageTimestamp ?? 0));

  resumo.foraDaJanela = resumo.recebidas - emOrdem.length;

  for (const msg of emOrdem) {
    try {
      const feito = await importarUma(msg, companyId, whatsappId, resumo);
      if (!feito) resumo.ignoradas += 1;
    } catch (err) {
      // Uma mensagem estranha não pode derrubar a importação inteira: o resto
      // das conversas vale mais que a linha que falhou.
      resumo.ignoradas += 1;
      logger.warn({ err, id: msg.key?.id }, "[historico] não consegui importar uma mensagem");
    }
  }

  logger.info({ ...resumo, dias, companyId, whatsappId }, "[historico] importação concluída");
  return resumo;
}

async function importarUma(
  msg: proto.IWebMessageInfo,
  companyId: number,
  whatsappId: number,
  resumo: ResumoDaImportacao
): Promise<boolean> {
  const jid = msg.key?.remoteJid ?? "";
  const wid = msg.key?.id ?? "";
  if (!wid || !CONVERSA_DE_PESSOA.test(jid)) return false;
  if (!msg.message) return false;

  // O id do WhatsApp é a chave primária da tabela de mensagens: é ele que
  // garante que importar duas vezes não duplica nada no quadro.
  if (await Message.findByPk(wid)) {
    resumo.jaExistiam += 1;
    return true;
  }

  // Telefone quando dá; o identificador inteiro quando o WhatsApp só manda o
  // `@lid` — é o mesmo critério que o caminho das mensagens ao vivo já usa, e
  // manter os dois iguais é o que evita o mesmo lead virar dois contatos.
  const numero = jid.endsWith("@lid") ? jid : jid.replace(/@.*$/, "");
  const corpo = (await getBodyMessage(msg.message)) ?? "";
  const tipo = descobrirTipo(msg.message);

  // Mensagem sem texto e sem mídia reconhecível não vira card: seria uma linha
  // em branco no meio da conversa.
  if (!corpo && tipo === "chat") return false;

  const contato = await acharOuCriarContato(numero, msg.pushName ?? "", companyId, resumo);
  const ticket = await acharOuCriarTicket(contato.id, companyId, whatsappId, resumo);

  const quando = new Date(Number(msg.messageTimestamp ?? 0) * 1000);

  await Message.create({
    id: wid,
    ticketId: ticket.id,
    contactId: msg.key?.fromMe ? null : contato.id,
    companyId,
    body: corpo || rotuloDaMidia(tipo),
    fromMe: !!msg.key?.fromMe,
    mediaType: tipo,
    remoteJid: jid,
    channel: "whatsapp",
    // Tudo que entra por aqui já foi lido no celular. Marcar como não lida
    // encheria o quadro de bolinha vermelha em conversa que o Hélio já atendeu.
    read: true,
    ack: 3,
    dataJson: JSON.stringify(msg),
    createdAt: quando,
    updatedAt: quando
  } as never);

  resumo.importadas += 1;

  // O card mostra a última mensagem. Só sobe se esta for mais nova do que a que
  // já está lá — importar não pode fazer o card andar para trás no tempo.
  if (!ticket.updatedAt || ticket.updatedAt < quando) {
    await ticket.update({
      lastMessage: (corpo || rotuloDaMidia(tipo)).slice(0, 255),
      updatedAt: quando
    } as never);
  }

  return true;
}

async function acharOuCriarContato(
  numero: string,
  pushName: string,
  companyId: number,
  resumo: ResumoDaImportacao
): Promise<Contact> {
  const existente = await Contact.findOne({ where: { number: numero, companyId } });
  if (existente) return existente;

  resumo.contatosCriados += 1;
  return Contact.create({
    name: pushName?.trim() || numero,
    number: numero,
    companyId,
    isGroup: false
  } as never);
}

/**
 * Reaproveita a conversa aberta, se houver.
 *
 * Abrir um card novo para quem já tem um espalharia o mesmo lead em duas
 * colunas do Kanban — exatamente a desorganização que a importação veio
 * resolver. Conversa fechada também é reaberta em vez de duplicada.
 */
async function acharOuCriarTicket(
  contactId: number,
  companyId: number,
  whatsappId: number,
  resumo: ResumoDaImportacao
): Promise<Ticket> {
  const existente = await Ticket.findOne({
    where: {
      contactId,
      companyId,
      status: { [Op.in]: ["open", "pending", "closed"] }
    },
    order: [["updatedAt", "DESC"]]
  });
  if (existente) return existente;

  resumo.ticketsCriados += 1;
  return Ticket.create({
    contactId,
    companyId,
    whatsappId,
    status: "pending",
    isGroup: false,
    unreadMessages: 0
  } as never);
}

function descobrirTipo(m: proto.IMessage): string {
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage || m.documentWithCaptionMessage) return "document";
  if (m.stickerMessage) return "sticker";
  if (m.locationMessage) return "location";
  if (m.contactMessage || m.contactsArrayMessage) return "contact";
  return "chat";
}

/**
 * O arquivo em si não vem no histórico — o WhatsApp manda só a referência, e
 * baixar exigiria a chave de mídia de cada mensagem. Então o card diz o que era,
 * em vez de mostrar uma linha vazia que ninguém entende.
 */
function rotuloDaMidia(tipo: string): string {
  const rotulos: Record<string, string> = {
    image: "[imagem enviada pelo WhatsApp]",
    video: "[vídeo enviado pelo WhatsApp]",
    audio: "[áudio enviado pelo WhatsApp]",
    document: "[documento enviado pelo WhatsApp]",
    sticker: "[figurinha]",
    location: "[localização]",
    contact: "[contato compartilhado]"
  };
  return rotulos[tipo] ?? "[mensagem]";
}
