import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";

/**
 * Junta dois cadastros que são a mesma pessoa.
 *
 * Por que isso passou a ser necessário: o WhatsApp entrega parte das conversas
 * com um identificador anônimo (`@lid`) em vez do telefone. A mesma pessoa chega
 * duas vezes — o histórico sob o identificador, a mensagem de hoje sob o número
 * — e o Kanban mostra dois cards do mesmo lead, um deles parecendo sem
 * histórico. Tentar salvar o telefone no cadastro anônimo esbarra na unicidade
 * do número e devolve "duplicado", sem caminho para a frente.
 *
 * 🚨 Nenhuma mensagem é apagada. As conversas do cadastro de origem passam para o
 * de destino, e só o registro vazio do contato some no fim.
 */
interface Requisicao {
  /** Quem deixa de existir — tipicamente o cadastro do identificador anônimo. */
  origemId: number;
  /** Quem fica, com tudo junto. */
  destinoId: number;
  companyId: number;
}

export interface ResultadoDaJuncao {
  contato: Contact;
  mensagensMovidas: number;
  conversasMovidas: number;
  conversasFundidas: number;
}

const MergeContactsService = async ({
  origemId,
  destinoId,
  companyId
}: Requisicao): Promise<ResultadoDaJuncao> => {
  if (origemId === destinoId) {
    throw new AppError("ERR_MERGE_SAME_CONTACT", 400);
  }

  const [origem, destino] = await Promise.all([
    Contact.findOne({ where: { id: origemId, companyId } }),
    Contact.findOne({ where: { id: destinoId, companyId } })
  ]);
  if (!origem || !destino) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  const conversasDaOrigem = await Ticket.findAll({
    where: { contactId: origem.id, companyId }
  });

  let mensagensMovidas = 0;
  let conversasMovidas = 0;
  let conversasFundidas = 0;

  for (const conversa of conversasDaOrigem) {
    /*
     * Se o destino já tem uma conversa aberta, as mensagens entram NELA em vez
     * de o lead continuar com dois cards. Mudar só o dono da conversa resolveria
     * a duplicidade do cadastro e deixaria a do quadro, que é a que incomoda.
     */
    const conversaDoDestino = await Ticket.findOne({
      where: {
        contactId: destino.id,
        companyId,
        status: { [Op.in]: ["open", "pending"] }
      },
      order: [["updatedAt", "DESC"]]
    });

    if (conversaDoDestino) {
      const [movidas] = await Message.update(
        { ticketId: conversaDoDestino.id, contactId: destino.id },
        { where: { ticketId: conversa.id } }
      );
      mensagensMovidas += movidas;
      conversasFundidas += 1;

      // A conversa de origem fica sem nenhuma mensagem: é um registro vazio, não
      // um atendimento. Sai para não virar um card mudo no quadro.
      await conversa.destroy();
    } else {
      await Message.update(
        { contactId: destino.id },
        { where: { ticketId: conversa.id, contactId: origem.id } }
      );
      await conversa.update({ contactId: destino.id });
      conversasMovidas += 1;
    }
  }

  /*
   * O que o destino não tem, herda. Nome de verdade vence número: o cadastro
   * anônimo costuma trazer o nome que a pessoa usa no WhatsApp, e o do telefone
   * nasce com o próprio número no lugar do nome.
   */
  const soDigitos = (v: string | null) => !v || /^[0-9]+$/.test(v.replace(/\D/g, ""));
  const dados: Partial<Contact> = {};
  if (soDigitos(destino.name) && !soDigitos(origem.name)) dados.name = origem.name;
  if (!destino.email && origem.email) dados.email = origem.email;
  if (!destino.profilePicUrl && origem.profilePicUrl) {
    dados.profilePicUrl = origem.profilePicUrl;
  }
  if (Object.keys(dados).length) await destino.update(dados as never);

  // Campos personalizados que o destino ainda não tem.
  const extras = await ContactCustomField.findAll({ where: { contactId: origem.id } });
  for (const extra of extras) {
    const jaTem = await ContactCustomField.findOne({
      where: { contactId: destino.id, name: extra.name }
    });
    if (!jaTem) {
      await extra.update({ contactId: destino.id });
    }
  }

  await origem.destroy();

  logger.info(
    { origemId, destinoId, mensagensMovidas, conversasMovidas, conversasFundidas },
    "[contatos] cadastros juntados"
  );

  const atualizado = await Contact.findByPk(destino.id, {
    include: ["extraInfo", "tags"]
  });

  return {
    contato: atualizado as Contact,
    mensagensMovidas,
    conversasMovidas,
    conversasFundidas
  };
};

export default MergeContactsService;
