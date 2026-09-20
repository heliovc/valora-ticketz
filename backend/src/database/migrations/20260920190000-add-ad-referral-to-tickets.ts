import { QueryInterface, DataTypes } from "sequelize";

/**
 * De qual anúncio veio esta conversa.
 *
 * Quando alguém clica num anúncio de "clique para o WhatsApp", a Meta manda um
 * objeto `referral` junto com a PRIMEIRA mensagem daquele clique. Sem gravar
 * isso na hora, a informação se perde: a mensagem seguinte já vem sem nada, e
 * não há como perguntar depois.
 *
 * Fica no ticket, não no contato: a mesma pessoa pode voltar por outro anúncio
 * semanas depois, e cada conversa tem a sua origem. O contato é quem ela é; o
 * ticket é de onde ela veio desta vez.
 *
 * `ctwaClid` é o identificador do clique. Não serve para o atendente ver na
 * tela — serve para casar a venda com a campanha lá no gerenciador da Meta,
 * depois. É por isso que ele é guardado mesmo sem ter uso imediato.
 *
 * Só o canal oficial (Cloud API) recebe esses dados. No canal por QR Code os
 * campos ficam nulos, e a conversa é tratada como orgânica.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.addColumn("Tickets", "referralSourceId", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "referralSourceType", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "referralSourceUrl", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "referralHeadline", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "referralBody", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "referralCtwaClid", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      })
    ]);

    // Relatório de campanha pergunta "quantas conversas vieram do anúncio X" —
    // sem índice isso vira varredura na tabela mais movimentada do sistema.
    await queryInterface.addIndex("Tickets", ["referralSourceId"], {
      name: "tickets_referral_source_id"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Tickets", "tickets_referral_source_id");
    await Promise.all([
      queryInterface.removeColumn("Tickets", "referralSourceId"),
      queryInterface.removeColumn("Tickets", "referralSourceType"),
      queryInterface.removeColumn("Tickets", "referralSourceUrl"),
      queryInterface.removeColumn("Tickets", "referralHeadline"),
      queryInterface.removeColumn("Tickets", "referralBody"),
      queryInterface.removeColumn("Tickets", "referralCtwaClid")
    ]);
  }
};
