import { QueryInterface, DataTypes } from "sequelize";

/**
 * Consumo das IAs dos bots (11/11/2026): uma linha por modelo tentado em cada
 * resposta — tokens, custo, sucesso ou o tipo da falha. A chave nunca é
 * gravada: só a impressão digital (para agrupar) e os 4 últimos caracteres.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiUsageLogs", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      origem: { type: DataTypes.STRING(24), allowNull: false },
      canal: { type: DataTypes.STRING(16), allowNull: true },
      provider: { type: DataTypes.STRING(16), allowNull: false },
      model: { type: DataTypes.STRING(120), allowNull: false },
      chave: { type: DataTypes.STRING(16), allowNull: false },
      chaveFinal: { type: DataTypes.STRING(8), allowNull: true },
      dona: { type: DataTypes.STRING(8), allowNull: false },
      inputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      outputTokens: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      costUsd: { type: DataTypes.DECIMAL(12, 6), allowNull: true },
      ok: { type: DataTypes.BOOLEAN, allowNull: false },
      erro: { type: DataTypes.STRING(24), allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiUsageLogs", ["companyId", "createdAt"], { name: "ai_usage_logs_company_created" });
    await queryInterface.addIndex("AiUsageLogs", ["createdAt"], { name: "ai_usage_logs_created" });
    await queryInterface.addIndex("AiUsageLogs", ["chave", "createdAt"], { name: "ai_usage_logs_chave_created" });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("AiUsageLogs");
  }
};
