import { QueryInterface, DataTypes } from "sequelize";

/**
 * O registro de disparo passa a apontar para a AÇÃO, não só para a lista.
 *
 * Uma lista agora tem várias ações, e o "só na primeira vez" é por AÇÃO: a
 * mesma lista pode mandar a mensagem uma vez só e ligar o bot toda vez que o
 * card voltar. Sem esta coluna, a primeira ação executada bloquearia as outras.
 *
 * Anulável por causa das linhas antigas, de quando havia uma ação por lista.
 * `tagId` também passa a aceitar nulo: automação de conversa nova não pertence
 * a lista nenhuma.
 */
module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.addColumn(
        "TagAutomationRuns",
        "actionId",
        {
          type: DataTypes.INTEGER,
          allowNull: true,
          references: { model: "FunnelActions", key: "id" },
          onUpdate: "CASCADE",
          onDelete: "CASCADE"
        },
        { transaction }
      );
      await queryInterface.changeColumn(
        "TagAutomationRuns",
        "tagId",
        { type: DataTypes.INTEGER, allowNull: true },
        { transaction }
      );
      await queryInterface.addIndex(
        "TagAutomationRuns",
        ["ticketId", "actionId"],
        { transaction }
      );
    }),

  down: (queryInterface: QueryInterface) =>
    queryInterface.removeColumn("TagAutomationRuns", "actionId")
};
