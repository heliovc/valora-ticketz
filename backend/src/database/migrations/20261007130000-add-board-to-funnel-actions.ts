import { QueryInterface, DataTypes } from "sequelize";

/**
 * Automação de conversa nova por quadro.
 *
 * `FunnelActions.whatsappId` só tem sentido com `tagId` nulo (a Entrada): diz
 * de qual quadro é a conversa nova. Nulo = Funil principal, que é o estado de
 * toda automação já existente. As automações de lista não precisam disto — a
 * lista já pertence a um quadro (`Tags.whatsappId`).
 *
 * CASCADE de propósito: apagar a conexão apaga as automações de Entrada do
 * quadro dela. Com SET NULL elas cairiam no Funil principal e começariam a
 * disparar em conversas que ninguém configurou para isso.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("FunnelActions", "whatsappId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "Whatsapps", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "CASCADE"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("FunnelActions", "whatsappId");
  }
};
