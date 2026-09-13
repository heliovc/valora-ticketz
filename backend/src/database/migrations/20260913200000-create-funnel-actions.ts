import { QueryInterface, DataTypes } from "sequelize";

/**
 * A automação do funil deixa de ser uma mensagem só e vira uma LISTA de ações.
 *
 * `tagId` nulo = automação de CONVERSA NOVA (a coluna "Entrada"), que não nasce
 * de nenhuma lista.
 */
module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.sequelize.transaction(async transaction => {
      await queryInterface.createTable(
        "FunnelActions",
        {
          id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false
          },
          tagId: {
            type: DataTypes.INTEGER,
            allowNull: true,
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
          ordem: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
          tipo: { type: DataTypes.STRING, allowNull: false },
          config: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: {}
          },
          atrasoMinutos: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0
          },
          umaVezSo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
          },
          soHorarioComercial: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
          },
          ativo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
          },
          createdAt: { type: DataTypes.DATE, allowNull: false },
          updatedAt: { type: DataTypes.DATE, allowNull: false }
        },
        { transaction }
      );

      await queryInterface.addIndex("FunnelActions", ["companyId", "tagId"], {
        transaction
      });

      // Migra o gatilho antigo (mensagem nas colunas da Tag) para a primeira
      // ação de cada lista. Sem isso, quem já configurou um gatilho o perderia
      // no deploy — e a mensagem simplesmente pararia de sair, sem aviso.
      await queryInterface.sequelize.query(
        `INSERT INTO "FunnelActions"
           ("tagId","companyId","ordem","tipo","config","atrasoMinutos","umaVezSo","soHorarioComercial","ativo","createdAt","updatedAt")
         SELECT id, "companyId", 0, 'mensagem',
                jsonb_build_object('mensagem', "autoMessage"),
                COALESCE("autoDelayMinutes",0), COALESCE("autoOnce",true),
                COALESCE("autoBusinessHoursOnly",true), true, NOW(), NOW()
           FROM "Tags"
          WHERE "autoMessage" IS NOT NULL AND btrim("autoMessage") <> ''`,
        { transaction }
      );
    }),

  down: (queryInterface: QueryInterface) =>
    queryInterface.dropTable("FunnelActions")
};
