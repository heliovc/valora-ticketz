import { QueryInterface, DataTypes } from "sequelize";

/**
 * Canal WhatsApp Oficial (Meta Cloud API) — colunas da conexão.
 *
 * O canal nasce IRMÃO do Baileys (`channel = "whatsapp"`) e do Chat do Site
 * (`channel = "webchat"`), não substituto: as três linhas convivem na mesma
 * tabela e a coluna `channel` continua sendo o discriminador.
 *
 * Por que colunas novas em vez de reusar `tokenMeta`/`facebookPageUserId`, que
 * estão órfãs: elas são resíduo do Messenger que o upstream deletou em
 * 18/01/2025. Se o upstream voltar a usá-las, o merge vira corrupção silenciosa
 * de dados. O prefixo `cloudApi` é inequivocamente nosso e sobrevive a rebase.
 *
 * `cloudApiPhoneNumberId` é a CHAVE DE ROTEAMENTO do webhook: um App da Meta
 * tem UMA URL de webhook para todas as contas inscritas, então é por este campo
 * que se descobre de qual empresa é a mensagem que chegou. Daí o índice único.
 *
 * `Tickets.lastInboundAt` guarda quando o cliente falou pela última vez. Na
 * Cloud API, passadas 24h dessa marca, só sai template aprovado pela Meta — sem
 * esta coluna não há como saber, antes de enviar, se a mensagem vai ser aceita.
 */
module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await Promise.all([
      queryInterface.addColumn("Whatsapps", "cloudApiPhoneNumberId", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Whatsapps", "cloudApiWabaId", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      // Vazia na fase 1; preenchida pelo Embedded Signup quando cada lojista
      // conectar a própria conta. Criada agora para não haver migration depois.
      queryInterface.addColumn("Whatsapps", "cloudApiBusinessId", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Whatsapps", "cloudApiTokenEnc", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Whatsapps", "cloudApiDisplayNumber", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Whatsapps", "cloudApiVerifiedName", {
        type: DataTypes.TEXT,
        allowNull: true,
        defaultValue: null
      }),
      queryInterface.addColumn("Tickets", "lastInboundAt", {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null
      })
    ]);

    await queryInterface.addIndex("Whatsapps", ["cloudApiPhoneNumberId"], {
      name: "whatsapps_cloud_api_phone_number_id_unique",
      unique: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex(
      "Whatsapps",
      "whatsapps_cloud_api_phone_number_id_unique"
    );
    await Promise.all([
      queryInterface.removeColumn("Whatsapps", "cloudApiPhoneNumberId"),
      queryInterface.removeColumn("Whatsapps", "cloudApiWabaId"),
      queryInterface.removeColumn("Whatsapps", "cloudApiBusinessId"),
      queryInterface.removeColumn("Whatsapps", "cloudApiTokenEnc"),
      queryInterface.removeColumn("Whatsapps", "cloudApiDisplayNumber"),
      queryInterface.removeColumn("Whatsapps", "cloudApiVerifiedName"),
      queryInterface.removeColumn("Tickets", "lastInboundAt")
    ]);
  }
};
