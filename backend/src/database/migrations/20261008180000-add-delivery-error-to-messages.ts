import { QueryInterface, DataTypes } from "sequelize";

/**
 * Motivo de uma mensagem não entregue (WhatsApp Oficial).
 *
 * A Meta avisa a falha só depois, pelo webhook de status. Sem guardar o
 * motivo, a mensagem ficava "enviada" para sempre na tela e ninguém sabia
 * que o cliente nunca recebeu.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Messages", "deliveryError", {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null
    });
  },
  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Messages", "deliveryError");
  }
};
