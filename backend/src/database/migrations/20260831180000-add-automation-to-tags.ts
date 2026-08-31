import { QueryInterface, DataTypes } from "sequelize";

/**
 * Gatilho por lista do funil: quando um card entra numa lista, o CRM manda uma
 * mensagem sozinho.
 *
 * Os campos moram na própria Tag porque no funil UMA lista tem UMA regra — é
 * assim que o usuário pensa ("quando cair em Proposta enviada, manda isso"). Uma
 * tabela de regras separada permitiria N regras por lista e exigiria uma tela
 * nova para gerenciá-las; nada disso foi pedido, e a simplicidade é o argumento
 * de venda do produto.
 *
 * Tudo numa transação: meia migração aplicada deixaria o modelo mentindo sobre
 * as colunas que existem.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      // Vazio = lista sem gatilho. É o estado de todas as listas que já existem.
      await queryInterface.addColumn(
        "Tags",
        "autoMessage",
        { type: DataTypes.TEXT, allowNull: true },
        { transaction }
      );
      // Espera antes de enviar. Zero = na hora.
      await queryInterface.addColumn(
        "Tags",
        "autoDelayMinutes",
        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        { transaction }
      );
      // Card que volta para a mesma lista não dispara de novo.
      await queryInterface.addColumn(
        "Tags",
        "autoOnce",
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        { transaction }
      );
      // Fora do expediente a mensagem espera a abertura, em vez de tocar o
      // telefone do cliente de madrugada — e de queimar o número.
      await queryInterface.addColumn(
        "Tags",
        "autoBusinessHoursOnly",
        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        { transaction }
      );
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.removeColumn("Tags", "autoMessage", { transaction });
      await queryInterface.removeColumn("Tags", "autoDelayMinutes", { transaction });
      await queryInterface.removeColumn("Tags", "autoOnce", { transaction });
      await queryInterface.removeColumn("Tags", "autoBusinessHoursOnly", { transaction });
    });
  }
};
