exports.up = async function (knex) {
  // Alter scans table to add new dimensions and remove scenario
  const hasTable = await knex.schema.hasTable("scans");
  if (hasTable) {
    await knex.schema.alterTable("scans", (table) => {
      table.string("deployment_context", 100).defaultTo("internet_facing");
      table.string("threat_horizon", 100).defaultTo("baseline_2033");
      table.string("business_criticality", 100).defaultTo("high");
    });
    
    // We can't drop 'scenario' immediately if it's used elsewhere, but we can if we want to migrate fully.
    // The user requested a FULL implementation, not cosmetic.
    // However, SQLite doesn't always support dropColumn well. So we'll try catching if it fails.
    try {
      await knex.schema.alterTable("scans", (table) => {
        table.dropColumn("scenario");
      });
    } catch (e) {
      console.warn("Could not drop scenario column", e.message);
    }
  }
};

exports.down = async function (knex) {
  const hasTable = await knex.schema.hasTable("scans");
  if (hasTable) {
    await knex.schema.alterTable("scans", (table) => {
      table.string("scenario", 100).defaultTo("baseline");
      table.dropColumn("deployment_context");
      table.dropColumn("threat_horizon");
      table.dropColumn("business_criticality");
    });
  }
};
