import { QueryInterface, DataTypes } from "sequelize";

/**
 * Registro de disparo do gatilho de lista.
 *
 * Existe por dois motivos: sustentar o "só na primeira vez" (sem isto, um card
 * que volta para a lista dispara de novo) e servir de prova do que foi enviado
 * automaticamente — mensagem automática que ninguém consegue auditar vira
 * discussão com o cliente.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("TagAutomationRuns", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      ticketId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tickets", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      tagId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Tags", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      companyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE"
      },
      // Preenchido só quando a mensagem sai de verdade. Nulo = enfileirada.
      sentAt: { type: DataTypes.DATE, allowNull: true },
      // Motivo de não ter saído (card saiu da lista, envio falhou).
      skippedReason: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.addIndex("TagAutomationRuns", ["ticketId", "tagId"]);
    await queryInterface.addIndex("TagAutomationRuns", ["companyId"]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("TagAutomationRuns");
  }
};
