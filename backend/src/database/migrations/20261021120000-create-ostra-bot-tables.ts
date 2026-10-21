import { QueryInterface, DataTypes } from "sequelize";

/**
 * Assistente do grupo Ostra Carioca (ver `services/OstraBotServices`).
 *
 * `ostra_bot_drafts`: cada pedido "Claude, ..." do grupo vira um rascunho que
 * só sai com o "ok" do Hélio. O status nunca volta: ENVIANDO é gravado ANTES
 * de chamar o WhatsApp, então uma queda no meio do envio deixa o rascunho
 * parado em ENVIANDO e ele nunca é reenviado sozinho.
 *
 * `pego_em`: quando o Mac do Hélio buscou o pedido para gerar o texto (o
 * modelo roda lá, no Claude Code do plano Max, sem chave de API no servidor).
 * `avisado_mac`: o Hélio já foi avisado de que o pedido espera o Mac ligado.
 *
 * `ostra_bot_messages`: o Ticketz ignora grupos e não guarda nada deles. Esta
 * tabela é o histórico que vai de contexto para o modelo (últimas 50).
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("ostra_bot_drafts", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      group_jid: { type: DataTypes.STRING, allowNull: false },
      mensagem_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      pergunta: { type: DataTypes.TEXT, allowNull: false },
      autor: { type: DataTypes.STRING, allowNull: false },
      autor_jid: { type: DataTypes.STRING, allowNull: true },
      rascunho: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false },
      expira_em: { type: DataTypes.DATE, allowNull: true },
      aprovado_em: { type: DataTypes.DATE, allowNull: true },
      enviado_em: { type: DataTypes.DATE, allowNull: true },
      erro: { type: DataTypes.TEXT, allowNull: true },
      pego_em: { type: DataTypes.DATE, allowNull: true },
      avisado_mac: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      },
      criado_em: { type: DataTypes.DATE, allowNull: false },
      atualizado_em: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("ostra_bot_drafts", ["status"]);

    await queryInterface.createTable("ostra_bot_messages", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      group_jid: { type: DataTypes.STRING, allowNull: false },
      mensagem_id: { type: DataTypes.STRING, allowNull: false, unique: true },
      autor: { type: DataTypes.STRING, allowNull: false },
      texto: { type: DataTypes.TEXT, allowNull: false },
      enviada_em: { type: DataTypes.DATE, allowNull: false },
      criado_em: { type: DataTypes.DATE, allowNull: false }
    });
    await queryInterface.addIndex("ostra_bot_messages", [
      "group_jid",
      "enviada_em"
    ]);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("ostra_bot_messages");
    await queryInterface.dropTable("ostra_bot_drafts");
  }
};
