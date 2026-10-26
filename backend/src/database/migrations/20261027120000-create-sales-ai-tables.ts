import { QueryInterface, DataTypes } from "sequelize";

/**
 * Val Vendas (27/10/2026): IA comercial que só atende leads do Elo Eventos.
 *
 * Tudo que é regra mora aqui, editável pelo painel da Valora — o código só
 * traz os valores iniciais. Mudanças só aditivas: nada existente é apagado.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("SalesAiConfigs", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false,
        unique: true
      },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      whatsappIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      campaignStartAt: { type: DataTypes.DATE, allowNull: true },
      listWindowDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30 },
      refCodeScanMessages: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
      humanPauseMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1440 },
      valCommandsEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      maxAiMessagesPerConversation: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 40 },
      maxAiMessagesPerMinute: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 6 },
      rules: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      businessHours: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      handoff: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      prospecting: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      protocol: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await queryInterface.createTable("CampaignRefs", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      code: { type: DataTypes.STRING(48), allowNull: false },
      channel: { type: DataTypes.STRING(40), allowNull: false },
      campaignName: { type: DataTypes.STRING(160), allowNull: false },
      prefilledText: { type: DataTypes.TEXT, allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CampaignRefs", ["companyId", "code"], {
      unique: true,
      name: "campaign_refs_company_code"
    });

    await queryInterface.createTable("CampaignListMembers", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      listName: { type: DataTypes.STRING(160), allowNull: false },
      number: { type: DataTypes.STRING(32), allowNull: false },
      campaignRef: { type: DataTypes.STRING(48), allowNull: true },
      lastCampaignMessageAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CampaignListMembers", ["companyId", "number", "listName"], {
      unique: true,
      name: "campaign_list_members_company_number_list"
    });

    await queryInterface.createTable("AiDecisionLogs", {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: true },
      contactId: { type: DataTypes.INTEGER, allowNull: true },
      messageId: { type: DataTypes.STRING, allowNull: true },
      whatsappId: { type: DataTypes.INTEGER, allowNull: true },
      reply: { type: DataTypes.BOOLEAN, allowNull: false },
      reason: { type: DataTypes.STRING(64), allowNull: false },
      details: { type: DataTypes.JSONB, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("AiDecisionLogs", ["companyId", "createdAt"], { name: "ai_decision_logs_company_created" });
    await queryInterface.addIndex("AiDecisionLogs", ["ticketId"], { name: "ai_decision_logs_ticket" });

    await queryInterface.createTable("SalesPlaybookVersions", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      version: { type: DataTypes.INTEGER, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      note: { type: DataTypes.STRING(240), allowNull: true },
      author: { type: DataTypes.STRING(160), allowNull: true },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    await Promise.all([
      queryInterface.addColumn("Tickets", "salesSource", { type: DataTypes.STRING(40), allowNull: true }),
      queryInterface.addColumn("Tickets", "salesSourceVia", { type: DataTypes.STRING(20), allowNull: true }),
      queryInterface.addColumn("Tickets", "campaignRef", { type: DataTypes.STRING(48), allowNull: true }),
      queryInterface.addColumn("Tickets", "attributedAt", { type: DataTypes.DATE, allowNull: true }),
      queryInterface.addColumn("Tickets", "salesStage", { type: DataTypes.STRING(32), allowNull: true }),
      queryInterface.addColumn("Tickets", "salesSummary", { type: DataTypes.TEXT, allowNull: true }),
      queryInterface.addColumn("Tickets", "aiPausedUntil", { type: DataTypes.DATE, allowNull: true }),
      queryInterface.addColumn("Messages", "sentBy", { type: DataTypes.STRING(16), allowNull: true }),
      queryInterface.addColumn("Messages", "bodyOriginal", { type: DataTypes.TEXT, allowNull: true }),
      queryInterface.addColumn("Contacts", "isPersonal", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false })
    ]);
    await queryInterface.addIndex("Tickets", ["companyId", "salesSource"], { name: "tickets_company_sales_source" });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("Tickets", "tickets_company_sales_source");
    await Promise.all([
      queryInterface.removeColumn("Tickets", "salesSource"),
      queryInterface.removeColumn("Tickets", "salesSourceVia"),
      queryInterface.removeColumn("Tickets", "campaignRef"),
      queryInterface.removeColumn("Tickets", "attributedAt"),
      queryInterface.removeColumn("Tickets", "salesStage"),
      queryInterface.removeColumn("Tickets", "salesSummary"),
      queryInterface.removeColumn("Tickets", "aiPausedUntil"),
      queryInterface.removeColumn("Messages", "sentBy"),
      queryInterface.removeColumn("Messages", "bodyOriginal"),
      queryInterface.removeColumn("Contacts", "isPersonal")
    ]);
    await queryInterface.dropTable("SalesPlaybookVersions");
    await queryInterface.dropTable("AiDecisionLogs");
    await queryInterface.dropTable("CampaignListMembers");
    await queryInterface.dropTable("CampaignRefs");
    await queryInterface.dropTable("SalesAiConfigs");
  }
};
