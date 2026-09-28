exports.up = async function (knex) {
  const hasTable = await knex.schema.hasTable("scans");
  if (hasTable) {
    const hasCol = await knex.schema.hasColumn("scans", "coverage_stats");
    if (!hasCol) {
      await knex.schema.alterTable("scans", (table) => {
        table.jsonb("coverage_stats").nullable();
      });
    }
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("scans");
  if (hasTable) {
    const hasCol = await knex.schema.hasColumn("scans", "coverage_stats");
    if (hasCol) {
      await knex.schema.alterTable("scans", (table) => {
        table.dropColumn("coverage_stats");
      });
    }
  }
};
