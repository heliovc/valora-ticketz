import { QueryInterface, DataTypes } from "sequelize";

/**
 * Quadro próprio por conexão no Funil.
 *
 * `Whatsapps.ownBoard` tira as conversas da conexão do Funil principal: elas
 * passam a aparecer só no quadro dela. `Tags.whatsappId` diz a qual quadro uma
 * coluna pertence — nulo é o Funil principal, que é o estado de toda coluna já
 * existente, então nada muda para quem não ligar o quadro próprio.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "ownBoard", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn("Tags", "whatsappId", {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      references: { model: "Whatsapps", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tags", "whatsappId");
    await queryInterface.removeColumn("Whatsapps", "ownBoard");
  }
};
