/**
 * Migration: Phase 1 - Asset Inventory Discovery
 * Enhances the assets table with rich, queryable cryptographic identity fields.
 */
exports.up = async function(knex) {
  await knex.schema.alterTable("assets", (table) => {
    table.string("tenant_id", 100).index(); // For easier cross-scan tenant isolation querying
    
    // Core Cryptographic Identity
    table.string("algorithm", 100).index();
    table.string("primitive", 50);
    table.integer("key_size");
    table.string("usage", 100);
    
    // Deployment Context
    table.string("location", 255).index();
    table.string("owner", 100);
    table.string("service", 100);
    table.string("protocol", 100);
    
    // Detailed Metadata
    table.jsonb("certificate"); // X.509 cert parsed details
    table.string("source", 100);
    table.float("confidence").defaultTo(1.0);
    table.boolean("is_synthetic").defaultTo(false);
    table.timestamp("discovered_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // Try to set tenant_id on assets from their scans
  await knex.raw(`
    UPDATE assets 
    SET tenant_id = scans.tenant_id
    FROM scans
    WHERE assets.scan_id = scans.id
  `);
};

exports.down = async function(knex) {
  await knex.schema.alterTable("assets", (table) => {
    table.dropColumn("tenant_id");
    table.dropColumn("algorithm");
    table.dropColumn("primitive");
    table.dropColumn("key_size");
    table.dropColumn("usage");
    table.dropColumn("location");
    table.dropColumn("owner");
    table.dropColumn("service");
    table.dropColumn("protocol");
    table.dropColumn("certificate");
    table.dropColumn("source");
    table.dropColumn("confidence");
    table.dropColumn("is_synthetic");
    table.dropColumn("discovered_at");
  });
};
