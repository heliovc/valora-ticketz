import { QueryInterface, DataTypes } from "sequelize";

/**
 * "Sem resposta" no Funil (22/10/2026).
 *
 * `unreadMessages` zera quando o atendente ABRE a conversa — respondendo ou
 * não —, então o card perdia a marca de pendente justamente quando mais
 * importava. Estas duas colunas registram quem falou por último e quando o
 * cliente falou pela última vez, em qualquer canal. Quem grava é o
 * `CreateMessageService`, por onde passa toda mensagem.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.addColumn("Tickets", "lastMessageFromMe", {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "lastClientMessageAt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
      })
    ]);
  },

  down: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.removeColumn("Tickets", "lastMessageFromMe"),
      queryInterface.removeColumn("Tickets", "lastClientMessageAt")
    ]);
  }
};
