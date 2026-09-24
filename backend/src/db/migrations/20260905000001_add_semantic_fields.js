exports.up = async function (knex) {
  const hasDetectionMethod = await knex.schema.hasColumn('findings', 'detection_method');
  const hasStatus = await knex.schema.hasColumn('findings', 'status');
  const hasDismissalReason = await knex.schema.hasColumn('findings', 'dismissal_reason');

  await knex.schema.alterTable("findings", (table) => {
    if (!hasDetectionMethod) table.string("detection_method", 50).defaultTo("deterministic");
    if (!hasStatus) table.string("status", 50).defaultTo("CONFIRMED");
    if (!hasDismissalReason) table.text("dismissal_reason");
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable("findings", (table) => {
    table.dropColumn("detection_method");
    table.dropColumn("status");
    table.dropColumn("dismissal_reason");
  });
};
