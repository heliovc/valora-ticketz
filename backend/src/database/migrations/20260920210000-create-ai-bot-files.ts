import { QueryInterface, DataTypes } from "sequelize";

/**
 * Arquivos de consulta do bot de IA (lista de preços, catálogo, FAQ).
 *
 * O lojista sobe o arquivo e o texto extraído dele entra no prompt do bot,
 * junto da base de conhecimento. Não é RAG: o conteúdo inteiro é injetado,
 * com teto de tamanho aplicado na montagem do prompt.
 *
 * `extractedText` guarda o texto JÁ extraído, e não o arquivo, porque a
 * extração é cara e o prompt é montado a cada mensagem recebida. O binário
 * fica no disco só para o lojista baixar de volta e para reprocessar.
 *
 * `charCount` existe para a tela poder avisar quando um arquivo rendeu zero
 * texto — é o caso do PDF que é só imagem escaneada, que sobe sem erro
 * nenhum e não serve para nada. Sem esse número o lojista acha que
 * configurou e o bot segue sem saber de nada.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiBotFiles", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
      },
      name: { type: DataTypes.TEXT, allowNull: false },
      mimetype: { type: DataTypes.TEXT, allowNull: false },
      filename: { type: DataTypes.TEXT, allowNull: false },
      size: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      extractedText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
      charCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        allowNull: false
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // Toda mensagem recebida lê os arquivos da empresa para montar o prompt.
    await queryInterface.addIndex("AiBotFiles", ["companyId"], {
      name: "ai_bot_files_company_id"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("AiBotFiles", "ai_bot_files_company_id");
    await queryInterface.dropTable("AiBotFiles");
  }
};
