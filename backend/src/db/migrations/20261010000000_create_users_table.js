/**
 * Migration: Create persistent users table
 * Replaces the in-memory Map in LocalAuthManager with PostgreSQL-backed storage.
 */
exports.up = async function (knex) {
  await knex.schema.createTable("users", (table) => {
    table.string("user_id", 100).primary();
    table.string("username", 64).notNullable().unique();
    table.string("email", 254).notNullable();
    table.text("password_hash").notNullable();
    table.specificType("roles", "text[]").notNullable().defaultTo("{}");
    table.string("tenant_id", 100).notNullable().defaultTo("default-tenant").index();
    table.integer("failed_attempts").notNullable().defaultTo(0);
    table.timestamp("locked_until", { useTz: true }).nullable();
    table.boolean("mfa_enabled").notNullable().defaultTo(false);
    table.text("mfa_secret").nullable();
    table.specificType("backup_code_hashes", "text[]").notNullable().defaultTo("{}");
    table.string("display_name", 100).nullable();
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("last_login_at", { useTz: true }).nullable();
    table.timestamp("password_changed_at", { useTz: true }).defaultTo(knex.fn.now());
    table.boolean("is_active").notNullable().defaultTo(true);
  });

  await knex.schema.table("users", (table) => {
    table.index(["tenant_id", "username"]);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("users");
};
