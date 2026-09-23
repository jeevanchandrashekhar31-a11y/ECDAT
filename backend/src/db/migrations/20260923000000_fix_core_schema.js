exports.up = async function(knex) {
  // 1. Add status column to findings
  await knex.schema.alterTable("findings", (table) => {
    table.string("status", 50).defaultTo("OPEN");
  });

  // 2. We can't safely add a foreign key to findings.asset_id immediately if there are orphaned findings.
  // First, let's delete findings where asset_id doesn't exist in assets table.
  await knex.raw(`
    DELETE FROM findings 
    WHERE asset_id NOT IN (SELECT id FROM assets)
  `);

  // Now add the foreign key
  await knex.schema.alterTable("findings", (table) => {
    table.foreign(["scan_id", "asset_id"]).references(["scan_id", "id"]).inTable("assets").onDelete("CASCADE");
  });

  // 3. Create remediations table
  await knex.schema.createTable("remediations", (table) => {
    table.string("id", 100).primary();
    table.string("state", 50).notNullable();
    table.string("title", 255);
    table.string("finding_id", 100).notNullable().references("id").inTable("findings").onDelete("CASCADE");
    table.string("proposer", 100);
    table.string("approver", 100);
    table.string("tenant_id", 100);
    table.jsonb("audit_history").defaultTo('[]');
    table.jsonb("metadata").defaultTo('{}');
    table.text("target_file");
    table.text("patch_content");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists("remediations");
  
  await knex.schema.alterTable("findings", (table) => {
    table.dropForeign("asset_id");
    table.dropColumn("status");
  });
};
