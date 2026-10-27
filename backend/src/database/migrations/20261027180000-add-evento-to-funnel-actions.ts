import { QueryInterface, DataTypes } from "sequelize";

/**
 * Gatilho "A IA passou para uma pessoa" (27/10/2026).
 *
 * Até aqui o gatilho de uma automação era a lista (`tagId`) ou a Entrada
 * (`tagId` nulo). `evento` abre espaço para gatilhos que não são lista:
 * nulo mantém tudo como estava; "ia_humano" dispara quando a IA passa a
 * conversa para a equipe.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("FunnelActions", "evento", {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("FunnelActions", "evento");
  }
};
