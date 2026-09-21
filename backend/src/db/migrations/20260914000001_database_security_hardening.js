/**
 * Migration: Database Security Hardening — Phase 16.2
 *
 * Implements:
 * 1. Database Audit Events Table (database_audit_events)
 * 2. Performance and Security Composite Indexes:
 *    - scans(project_id, created_at)
 *    - assets(scan_id, highest_severity)
 *    - assets(scan_id, at_quantum_risk)
 *    - findings(scan_id, algorithm, key_size)
 *    - cboms(created_at)
 *    - scan_errors(created_at)
 *    - database_audit_events(event_type, created_at)
 *    - database_audit_events(actor, created_at)
 */

exports.up = async function (knex) {
  // 1. Create database_audit_events table
  const hasAuditTable = await knex.schema.hasTable("database_audit_events");
  if (!hasAuditTable) {
    await knex.schema.createTable("database_audit_events", (table) => {
      table.string("id", 100).primary();
      table.string("event_type", 100).notNullable().index();
      table.string("table_name", 100).index();
      table.string("record_id", 255).index();
      table.string("actor", 100).notNullable().defaultTo("system").index();
      table.string("tenant_id", 100).index();
      table.string("action", 50).notNullable(); // INSERT, UPDATE, DELETE, QUERY, BACKUP, PRUNE, MIGRATION
      table.string("status", 50).notNullable().defaultTo("SUCCESS"); // SUCCESS, FAILED, BLOCKED
      table.jsonb("details");
      table.string("ip_address", 50);
      table
        .timestamp("created_at", { useTz: true })
        .defaultTo(knex.fn.now())
        .index();
    });
  }

  // 2. Add composite indexes on existing tables for security filtering and retention pruning
  // Helper to safely add index if table exists and index doesn't already exist
  const safeAddIndex = async (tableName, columns, indexName) => {
    const tableExists = await knex.schema.hasTable(tableName);
    if (!tableExists) return;

    try {
      await knex.schema.alterTable(tableName, (table) => {
        table.index(columns, indexName);
      });
    } catch (_err) {
      // Index might already exist
    }
  };

  // Ensure scans has tenant_id if upgrading an existing older DB
  const scansExists = await knex.schema.hasTable("scans");
  if (scansExists) {
    const hasTenantCol = await knex.schema.hasColumn("scans", "tenant_id");
    if (!hasTenantCol) {
      const hasTenantsTable = await knex.schema.hasTable("tenants");
      await knex.schema.alterTable("scans", (table) => {
        const col = table.string("tenant_id", 100).notNullable().defaultTo("default-tenant").index();
        if (hasTenantsTable) {
          col.references("id").inTable("tenants").onDelete("CASCADE");
        }
      });
    }
  }

  // Ensure policy_profiles has at least one default profile if upgrading an older DB
  const policyProfilesExists = await knex.schema.hasTable("policy_profiles");
  if (policyProfilesExists) {
    const defaultProfile = await knex("policy_profiles").first();
    if (!defaultProfile) {
      await knex("policy_profiles").insert({
        id: "internal_enterprise",
        name: "Internal Enterprise Network",
        description: "Internal microservices, intranet applications, and backend service-to-service communication.",
        min_rsa_bits: 2048,
        min_ecc_bits: 256,
        allow_self_signed: false,
        cicd_fail_threshold: "high",
        config: JSON.stringify({
          default_data_sensitivity: "internal",
          default_business_criticality: "medium",
          key_size_policy: { min_rsa_bits: 2048, min_ecc_bits: 256 },
        }),
      });
    }
  }

  await safeAddIndex("scans", ["project_id", "created_at"], "idx_scans_project_created");
  await safeAddIndex("scans", ["tenant_id", "created_at"], "idx_scans_tenant_created");
  await safeAddIndex("assets", ["scan_id", "highest_severity"], "idx_assets_scan_severity");
  await safeAddIndex("assets", ["scan_id", "at_quantum_risk"], "idx_assets_scan_quantum");
  await safeAddIndex("findings", ["scan_id", "algorithm", "key_size"], "idx_findings_scan_algo_keysize");
  await safeAddIndex("cboms", ["created_at"], "idx_cboms_created_at");
  await safeAddIndex("scan_errors", ["created_at"], "idx_scan_errors_created_at");
  await safeAddIndex("database_audit_events", ["event_type", "created_at"], "idx_audit_event_created");
  await safeAddIndex("database_audit_events", ["actor", "created_at"], "idx_audit_actor_created");
};

exports.down = async function (knex) {
  const safeDropIndex = async (tableName, indexName) => {
    const tableExists = await knex.schema.hasTable(tableName);
    if (!tableExists) return;

    try {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropIndex([], indexName);
      });
    } catch (_err) {
      // Ignore if index does not exist
    }
  };

  await safeDropIndex("scans", "idx_scans_project_created");
  await safeDropIndex("assets", "idx_assets_scan_severity");
  await safeDropIndex("assets", "idx_assets_scan_quantum");
  await safeDropIndex("findings", "idx_findings_scan_algo_keysize");
  await safeDropIndex("cboms", "idx_cboms_created_at");
  await safeDropIndex("scan_errors", "idx_scan_errors_created_at");
  await knex.schema.dropTableIfExists("database_audit_events");
};
