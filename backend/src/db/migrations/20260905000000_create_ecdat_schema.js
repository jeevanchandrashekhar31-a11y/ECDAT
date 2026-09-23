/**
 * Migration: Create ECDAT PostgreSQL Schema
 *
 * Entities created:
 * - rule_versions
 * - policy_profiles
 * - scans
 * - cboms
 * - assets
 * - components
 * - findings
 * - risk_assessments
 * - recommendations
 * - scan_errors
 */

exports.up = async function (knex) {
  // 1. rule_versions
  await knex.schema.createTable("rule_versions", (table) => {
    table.increments("id").primary();
    table.string("version", 50).notNullable();
    table.string("ruleset_type", 50).notNullable();
    table.jsonb("content").notNullable();
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.unique(["version", "ruleset_type"]);
  });

  // 2. policy_profiles
  await knex.schema.createTable("policy_profiles", (table) => {
    table.string("id", 100).primary(); // e.g. 'public_internet', 'internal_enterprise'
    table.string("name", 255).notNullable();
    table.text("description");
    table.integer("min_rsa_bits").notNullable().defaultTo(2048);
    table.integer("min_ecc_bits").notNullable().defaultTo(256);
    table.boolean("allow_self_signed").notNullable().defaultTo(false);
    table.string("cicd_fail_threshold", 50).notNullable().defaultTo("high");
    table.jsonb("config").notNullable();
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // Seed default policy profile row as part of migration so fresh knex migrate:latest
  // always leaves at least one valid policy_profile_id for scans to reference.
  await knex("policy_profiles").insert([
    {
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
    },
    {
      id: "regulated_bfsi",
      name: "Regulated BFSI (Strict)",
      description: "Strict policy for banking, financial services, and insurance.",
      min_rsa_bits: 3072,
      min_ecc_bits: 384,
      allow_self_signed: false,
      cicd_fail_threshold: "medium",
      config: JSON.stringify({
        default_data_sensitivity: "confidential",
        default_business_criticality: "high",
        key_size_policy: { min_rsa_bits: 3072, min_ecc_bits: 384 },
      }),
    }
  ]);

  // 3. scans
  const hasTenantsTable = await knex.schema.hasTable("tenants");
  await knex.schema.createTable("scans", (table) => {
    table.string("id", 100).primary();
    const tenantCol = table
      .string("tenant_id", 100)
      .notNullable()
      .defaultTo("default-tenant")
      .index();
    if (hasTenantsTable) {
      tenantCol.references("id").inTable("tenants").onDelete("CASCADE");
    }
    table.string("project_id", 100).defaultTo("default_project").index();
    table.string("target_name", 255).notNullable();
    table.string("scanner_type", 50).notNullable().defaultTo("combined");
    table
      .string("policy_profile_id", 100)
      .references("id")
      .inTable("policy_profiles")
      .onDelete("SET NULL");
    table.string("scenario", 50).defaultTo("baseline");
    table.string("status", 50).notNullable().defaultTo("completed").index();
    table.boolean("cicd_pass").defaultTo(true);
    table.integer("total_assets").defaultTo(0);
    table.integer("total_findings").defaultTo(0);
    table.integer("critical_count").defaultTo(0);
    table.integer("high_count").defaultTo(0);
    table.integer("medium_count").defaultTo(0);
    table.integer("low_count").defaultTo(0);
    table.integer("info_count").defaultTo(0);
    table.integer("quantum_risk_count").defaultTo(0);
    table
      .timestamp("created_at", { useTz: true })
      .defaultTo(knex.fn.now())
      .index();
    table.timestamp("completed_at", { useTz: true });
  });

  // 4. cboms (Immutable raw evidence and annotated CBOM)
  await knex.schema.createTable("cboms", (table) => {
    table.string("id", 100).primary();
    table
      .string("scan_id", 100)
      .notNullable()
      .unique()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE");
    table.jsonb("raw_json").notNullable();
    table.jsonb("annotated_json").notNullable();
    table.string("spec_version", 20).defaultTo("1.6");
    table.string("bom_format", 50).defaultTo("CycloneDX");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // 5. assets
  await knex.schema.createTable("assets", (table) => {
    table
      .string("scan_id", 100)
      .notNullable()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE");
    table.string("id", 255).notNullable();
    table.string("primary_identifier", 255).notNullable();
    table.string("asset_type", 50).notNullable().defaultTo("network_session");
    table.string("data_sensitivity", 50).defaultTo("internal");
    table.string("business_criticality", 50).defaultTo("medium");
    table.string("highest_severity", 50).defaultTo("Informational").index();
    table.boolean("at_quantum_risk").defaultTo(false).index();
    table.boolean("cicd_pass").defaultTo(true);
    table.jsonb("metadata");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.primary(["scan_id", "id"]);
  });

  // 6. components
  await knex.schema.createTable("components", (table) => {
    table
      .string("scan_id", 100)
      .notNullable()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE");
    table.string("id", 255).notNullable();
    table.string("asset_id", 255).notNullable();
    table.string("name", 255).notNullable();
    table
      .string("component_type", 50)
      .notNullable()
      .defaultTo("cryptographic-asset");
    table.string("version", 100);
    table.text("purl");
    table.text("cpe");
    table.jsonb("properties");
    table.jsonb("evidence");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
    table.primary(["scan_id", "id"]);
    table
      .foreign(["scan_id", "asset_id"])
      .references(["scan_id", "id"])
      .inTable("assets")
      .onDelete("CASCADE");
  });

  // 7. findings
  await knex.schema.createTable("findings", (table) => {
    table.string("id", 100).primary();
    table
      .string("scan_id", 100)
      .notNullable()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE")
      .index();
    table.string("component_id", 255).notNullable();
    table.string("asset_id", 255).notNullable();
    table.string("algorithm", 100).notNullable().index();
    table.integer("key_size");
    table.string("category", 50);
    table.string("finding_type", 50);
    table.text("location");
    table.integer("line_number");
    table.text("evidence_context");
    table.string("confidence", 50).defaultTo("high");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // 8. risk_assessments
  await knex.schema.createTable("risk_assessments", (table) => {
    table.string("id", 100).primary();
    table
      .string("finding_id", 100)
      .notNullable()
      .references("id")
      .inTable("findings")
      .onDelete("CASCADE");
    table
      .string("scan_id", 100)
      .notNullable()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE")
      .index();
    table.string("severity", 50).notNullable().index();
    table.string("classical_risk", 50).notNullable();
    table.string("quantum_relevance", 50).notNullable();
    table.string("mosca_status", 50).notNullable().index();
    table.decimal("mosca_x_years", 5, 1);
    table.decimal("mosca_y_years", 5, 1);
    table.decimal("mosca_z_years", 5, 1);
    table.decimal("mosca_margin_years", 5, 1);
    table.boolean("cicd_pass").notNullable().defaultTo(true);
    table.jsonb("applied_rules");
    table.jsonb("policy_violations");
    table.text("explanation").notNullable();
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // 9. recommendations
  await knex.schema.createTable("recommendations", (table) => {
    table.string("id", 100).primary();
    table
      .string("scan_id", 100)
      .notNullable()
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE")
      .index();
    table
      .string("finding_id", 100)
      .references("id")
      .inTable("findings")
      .onDelete("CASCADE");
    table.string("priority", 50).notNullable().index();
    table.text("current_state").notNullable();
    table.text("recommended_target").notNullable();
    table.text("classical_remediation");
    table.text("pqc_migration");
    table.boolean("hybrid_transition_recommended").defaultTo(false);
    table.string("migration_complexity", 50);
    table.string("latency_impact", 50);
    table.string("bandwidth_impact", 50);
    table.string("cost_category", 50);
    table.text("rationale");
    table.jsonb("references");
    table.jsonb("assumptions");
    table.boolean("benchmark_available").defaultTo(false);
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });

  // 10. scan_errors
  await knex.schema.createTable("scan_errors", (table) => {
    table.increments("id").primary();
    table
      .string("scan_id", 100)
      .references("id")
      .inTable("scans")
      .onDelete("CASCADE");
    table.string("error_code", 100);
    table.text("message").notNullable();
    table.jsonb("details");
    table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("scan_errors");
  await knex.schema.dropTableIfExists("recommendations");
  await knex.schema.dropTableIfExists("risk_assessments");
  await knex.schema.dropTableIfExists("findings");
  await knex.schema.dropTableIfExists("components");
  await knex.schema.dropTableIfExists("assets");
  await knex.schema.dropTableIfExists("cboms");
  await knex.schema.dropTableIfExists("scans");
  await knex.schema.dropTableIfExists("policy_profiles");
  await knex.schema.dropTableIfExists("rule_versions");
};
