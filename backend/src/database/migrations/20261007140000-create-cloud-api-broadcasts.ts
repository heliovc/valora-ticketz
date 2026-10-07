import { QueryInterface, DataTypes } from "sequelize";

/**
 * Disparo em massa pelo WhatsApp Oficial.
 *
 * Tabela própria em vez de reaproveitar `Campaigns`: a campanha herdada é
 * presa ao Baileys (sessão, validação de número pelo aparelho, texto livre) e
 * o oficial só fala com quem não escreveu por MODELO APROVADO. Misturar os
 * dois numa tabela só obrigaria cada linha a dizer qual metade dela vale.
 *
 * Um destinatário por linha em `CloudApiBroadcastRecipients`: é onde fica o
 * resultado de cada envio (wamid, erro, entregue, lido), que o webhook de
 * status atualiza pelo wamid.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("CloudApiBroadcasts", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      whatsappId: {
        type: DataTypes.INTEGER,
        references: { model: "Whatsapps", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      userId: {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
        allowNull: true
      },
      name: { type: DataTypes.TEXT, allowNull: false },
      templateName: { type: DataTypes.TEXT, allowNull: false },
      templateLanguage: { type: DataTypes.TEXT, allowNull: false },
      params: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: "EM_ANDAMENTO" },
      total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CloudApiBroadcasts", ["companyId"], {
      name: "cloud_api_broadcasts_company_id"
    });

    await queryInterface.createTable("CloudApiBroadcastRecipients", {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      broadcastId: {
        type: DataTypes.INTEGER,
        references: { model: "CloudApiBroadcasts", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      number: { type: DataTypes.TEXT, allowNull: false },
      name: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.TEXT, allowNull: false, defaultValue: "PENDENTE" },
      wamid: { type: DataTypes.TEXT, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      // O texto exato que saiu, para mostrar no card quando o cliente responder.
      text: { type: DataTypes.TEXT, allowNull: true },
      sentAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("CloudApiBroadcastRecipients", ["broadcastId", "status"], {
      name: "cloud_api_broadcast_recipients_broadcast_status"
    });
    await queryInterface.addIndex("CloudApiBroadcastRecipients", ["wamid"], {
      name: "cloud_api_broadcast_recipients_wamid"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("CloudApiBroadcastRecipients");
    await queryInterface.dropTable("CloudApiBroadcasts");
  }
};
