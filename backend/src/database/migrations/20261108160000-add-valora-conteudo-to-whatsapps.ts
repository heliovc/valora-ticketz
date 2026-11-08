import { QueryInterface, DataTypes } from "sequelize";

/**
 * Consultora virtual do Conteúdo IA (Valora, 08/11/2026).
 *
 * `Whatsapps.valoraConteudoIa`: o que fazer com as mensagens recebidas nesta
 * conexão do WhatsApp Oficial.
 *   - "off"         nada muda (padrão);
 *   - "autorizados" mensagem de número autorizado por algum lojista vai para a
 *                   consultora na Valora; as outras seguem o fluxo de sempre
 *                   (bot, funil, atendente) — serve para um número compartilhado;
 *   - "todos"       toda mensagem vai para a Valora — número dedicado.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Whatsapps", "valoraConteudoIa", {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: "off"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Whatsapps", "valoraConteudoIa");
  }
};
