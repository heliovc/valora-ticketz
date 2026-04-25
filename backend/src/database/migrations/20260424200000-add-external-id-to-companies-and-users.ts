import { DataTypes, QueryInterface } from "sequelize";

// Valora Smart integration — maps Ticketz tenants/users to Valora identifiers.
// Companies.externalId  = Valora userId of the contract holder (1 contract = 1 Company).
// Users.externalId       = Valora userId of the agent.
// Both nullable so native Ticketz signup (without SSO) keeps working as fallback.

export async function up(queryInterface: QueryInterface) {
  await queryInterface.sequelize.transaction(async transaction => {
    await queryInterface.addColumn(
      "Companies",
      "externalId",
      {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
      },
      { transaction }
    );

    await queryInterface.addColumn(
      "Users",
      "externalId",
      {
        type: DataTypes.STRING,
        allowNull: true
      },
      { transaction }
    );

    // (companyId, externalId) unique — same Valora user can be agent in
    // multiple companies, but only once per company. Postgres allows multiple
    // NULL externalId rows per companyId (NULLs are distinct in unique
    // indexes), so native Ticketz users (no externalId) still coexist.
    await queryInterface.addIndex("Users", ["companyId", "externalId"], {
      name: "users_companyid_externalid_unique",
      unique: true,
      transaction
    });
  });
}

export async function down(queryInterface: QueryInterface) {
  await queryInterface.sequelize.transaction(async transaction => {
    await queryInterface.removeIndex(
      "Users",
      "users_companyid_externalid_unique",
      { transaction }
    );
    await queryInterface.removeColumn("Users", "externalId", { transaction });
    await queryInterface.removeColumn("Companies", "externalId", {
      transaction
    });
  });
}
