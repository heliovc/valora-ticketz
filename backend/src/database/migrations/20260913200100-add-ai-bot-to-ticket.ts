import { QueryInterface, DataTypes } from "sequelize";

/**
 * Bot de IA por CONVERSA.
 *
 * Até aqui o bot era liga/desliga da empresa inteira: ou respondia tudo, ou
 * nada. Não dava para dizer "o bot atende quem está na lista Triagem, e para
 * quando um humano assume".
 *
 * NULO = segue a configuração da empresa (é o comportamento de hoje, e é por
 * isso que a coluna é anulável em vez de `false`: ninguém perde o bot no deploy).
 * true/false = decisão explícita desta conversa, que vence a da empresa.
 */
module.exports = {
  up: (queryInterface: QueryInterface) =>
    queryInterface.addColumn("Tickets", "aiBotEnabled", {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: null
    }),

  down: (queryInterface: QueryInterface) =>
    queryInterface.removeColumn("Tickets", "aiBotEnabled")
};
