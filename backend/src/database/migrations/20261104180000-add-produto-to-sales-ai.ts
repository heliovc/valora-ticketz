import { QueryInterface, DataTypes } from "sequelize";

/**
 * A IA comercial passa a vender mais de um produto no mesmo número (04/11/2026).
 *
 * `SalesPlaybookVersions.produto`: cada produto tem a sua playbook e a sua
 * sequência de versões. O que já existe é do Elo Eventos.
 * `SalesAiConfigs.produtos`: ajustes por produto, como o vídeo de demonstração.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("SalesPlaybookVersions", "produto", {
      type: DataTypes.STRING(40),
      allowNull: false,
      defaultValue: "elo_eventos"
    });
    await queryInterface.addColumn("SalesAiConfigs", "produtos", {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("SalesAiConfigs", "produtos");
    await queryInterface.removeColumn("SalesPlaybookVersions", "produto");
  }
};
