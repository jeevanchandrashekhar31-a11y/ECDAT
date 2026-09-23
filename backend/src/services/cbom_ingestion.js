const crypto = require("crypto");
const {
  annotateCbom,
  generateSummary,
  generateHtmlReport,
} = require("../risk_engine");
const {
  validateCbomStructure,
  redactPrivateKeys,
} = require("./cbom_validation");
const { db, isDbConnected } = require("../db/connection");
const config = require("../config");
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
const { defaultMetricsCollector } = require("../metrics");

// In-memory scan store fallback
const inMemoryScansStore = new Map();

/**
 * Persists an ingested scan transactionally to PostgreSQL.
 * If any step fails, transaction automatically rolls back.
 */
async function persistScanToPostgres(scanRecord, rawCbom) {
  const connected = await isDbConnected();
  if (!connected) {
    return false;
  }

  const hasScansTable = await db.schema.hasTable("scans").catch(() => false);
  if (!hasScansTable) {
    return false;
  }

  await db.transaction(async (trx) => {
    // Ensure tenant_id column exists for multi-tenant isolation
    const hasTenantCol = await trx.schema.hasColumn("scans", "tenant_id").catch(() => false);
    if (!hasTenantCol) {
      await trx.schema.alterTable("scans", (table) => {
        table.string("tenant_id", 100).defaultTo("default-tenant").index();
      }).catch(() => {});
    }

    // 1. Delete prior record if re-running scan with same ID (prevents duplicates)
    await trx("scans").where({ id: scanRecord.id }).del();

    // 2. Insert Scan record
    const scanRowData = {
      id: scanRecord.id,
      tenant_id: scanRecord.tenantId || "default-tenant",
      project_id: scanRecord.project_id || "default_project",
      target_name: scanRecord.name,
      scanner_type: scanRecord.scanner_type || "combined",
      policy_profile_id: scanRecord.policy_profile,
      scenario: scanRecord.scenario,
      status: "completed",
      cicd_pass: scanRecord.metrics.overall_cicd_pass,
      total_assets: scanRecord.metrics.total_assets,
      total_findings: scanRecord.metrics.total_findings,
      critical_count: scanRecord.metrics.severity_counts.critical,
      high_count: scanRecord.metrics.severity_counts.high,
      medium_count: scanRecord.metrics.severity_counts.medium,
      low_count: scanRecord.metrics.severity_counts.low,
      info_count: scanRecord.metrics.severity_counts.informational,
      quantum_risk_count: scanRecord.metrics.assets_at_quantum_risk,
      created_at: scanRecord.created_at,
      completed_at: new Date().toISOString(),
    };

    await trx("scans").insert(scanRowData);

    // 3. Insert CBOM (raw and annotated - both guaranteed free of private keys)
    await trx("cboms").insert({
      id: `cbom_${scanRecord.id}`,
      scan_id: scanRecord.id,
      raw_json: JSON.stringify(rawCbom || {}),
      annotated_json: JSON.stringify(scanRecord.annotated_bom || {}),
      spec_version: rawCbom && rawCbom.specVersion ? String(rawCbom.specVersion) : "1.6",
      bom_format: "CycloneDX",
    });

    // 4. Insert Assets
    const topAssets = scanRecord.top_risky_assets || [];
    for (const asset of topAssets) {
      const aid = String(asset.asset_id || "global").slice(0, 255);
      await trx("assets").insert({
        scan_id: scanRecord.id,
        id: aid,
        primary_identifier: aid,
        tenant_id: scanRecord.tenantId || "default-tenant",
        asset_type: String(asset.asset_type || "network_session").slice(0, 50),
        data_sensitivity: String(asset.data_sensitivity || "internal").slice(0, 50),
        business_criticality: String(asset.business_criticality || "medium").slice(0, 50),
        highest_severity: String(asset.severity || "Informational").slice(0, 50),
        at_quantum_risk:
          asset.mosca_status === "AT_RISK" ||
          asset.mosca_status === "CRITICAL_URGENT",
        cicd_pass: asset.cicd_pass !== false,
        // Phase 1 Rich Asset Properties
        algorithm: asset.algorithm ? String(asset.algorithm).slice(0, 100) : null,
        primitive: asset.primitive ? String(asset.primitive).slice(0, 50) : null,
        key_size: parseInt(asset.key_size, 10) || null,
        usage: asset.usage ? String(asset.usage).slice(0, 100) : null,
        location: asset.location ? String(asset.location).slice(0, 255) : null,
        owner: asset.owner ? String(asset.owner).slice(0, 100) : null,
        service: asset.service ? String(asset.service).slice(0, 100) : null,
        protocol: asset.protocol ? String(asset.protocol).slice(0, 100) : null,
        certificate: asset.certificate ? JSON.stringify(asset.certificate) : null,
        source: asset.source ? String(asset.source).slice(0, 100) : null,
        confidence: typeof asset.confidence === 'number' ? asset.confidence : 1.0,
        is_synthetic: Boolean(asset.is_synthetic),
        metadata: JSON.stringify(asset),
      }).onConflict(['scan_id', 'id']).merge();
    }

    // 5. Insert Findings & Risk Assessments
    const findings = scanRecord.classified_findings || [];
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const findingId = f.id || `fnd_${scanRecord.id}_${i}`;
      const compId = String(f.bom_ref || `comp_${scanRecord.id}_${i}`).slice(0, 255);
      const assetId = String(f.asset_id || f.bom_ref || "global").slice(0, 255);

      // Upsert asset row
      await trx("assets").insert({
        scan_id: scanRecord.id,
        id: assetId,
        primary_identifier: assetId,
        tenant_id: scanRecord.tenantId || "default-tenant",
        asset_type: String(f.asset_type || "network_session").slice(0, 50),
        data_sensitivity: String(f.data_sensitivity || "internal").slice(0, 50),
        business_criticality: String(f.business_criticality || "medium").slice(0, 50),
        highest_severity: String(f.severity || "Informational").slice(0, 50),
        at_quantum_risk:
          f.mosca?.status === "AT_RISK" ||
          f.mosca?.status === "CRITICAL_URGENT",
        cicd_pass: f.cicd_pass !== false,
        // Phase 1 Rich Asset Properties
        algorithm: f.algorithm ? String(f.algorithm).slice(0, 100) : null,
        primitive: f.primitive ? String(f.primitive).slice(0, 50) : null,
        key_size: parseInt(f.key_size, 10) || null,
        usage: f.usage ? String(f.usage).slice(0, 100) : null,
        location: f.location ? String(f.location).slice(0, 255) : null,
        owner: f.owner ? String(f.owner).slice(0, 100) : null,
        service: f.service ? String(f.service).slice(0, 100) : null,
        protocol: f.protocol ? String(f.protocol).slice(0, 100) : null,
        certificate: f.certificate ? JSON.stringify(f.certificate) : null,
        source: f.source ? String(f.source).slice(0, 100) : null,
        confidence: typeof f.confidence === 'number' ? f.confidence : 1.0,
        is_synthetic: Boolean(f.is_synthetic),
        metadata: JSON.stringify({ asset_id: assetId }),
      }).onConflict(['scan_id', 'id']).merge();

      // Ensure component row exists
      const compRow = await trx("components")
        .where({ scan_id: scanRecord.id, id: compId })
        .first();
      if (!compRow) {
        await trx("components").insert({
          scan_id: scanRecord.id,
          id: compId,
          asset_id: assetId,
          name: String(f.algorithm || "crypto-asset").slice(0, 255),
          component_type:
            f.asset_type === "library_presence"
              ? "library"
              : "cryptographic-asset",
          version: f.version ? String(f.version).slice(0, 100) : null,
        });
      }

      // Insert Finding
      await trx("findings").insert({
        id: findingId,
        scan_id: scanRecord.id,
        component_id: compId,
        asset_id: assetId,
        algorithm: String(f.algorithm || "crypto-asset").slice(0, 100),
        key_size: f.key_size || null,
        category: f.category ? String(f.category).slice(0, 50) : null,
        finding_type: f.asset_type ? String(f.asset_type).slice(0, 50) : null,
        location: f.file_path || f.location ? String(f.file_path || f.location).slice(0, 512) : null,
        line_number: f.line_number ? parseInt(f.line_number, 10) : null,
        evidence_context: f.raw_evidence
          ? JSON.stringify(f.raw_evidence)
          : null,
        confidence: String(f.confidence || "high").slice(0, 50),
      });

      // Insert Risk Assessment
      await trx("risk_assessments").insert({
        id: `ra_${findingId}`,
        finding_id: findingId,
        scan_id: scanRecord.id,
        severity: String(f.severity || "Informational").slice(0, 50),
        classical_risk: String(f.classical_risk || "NONE").slice(0, 50),
        quantum_relevance: String(f.quantum_relevance || "NONE").slice(0, 50),
        mosca_status: String(f.mosca?.status || "SAFE").slice(0, 50),
        mosca_x_years: f.mosca?.final_values?.X_shelf_life_years || 0,
        mosca_y_years: f.mosca?.final_values?.Y_migration_years || 0,
        mosca_z_years: f.mosca?.final_values?.Z_quantum_threat_years || 9,
        mosca_margin_years: f.mosca?.mosca_margin_years || 0,
        cicd_pass: f.cicd_pass,
        applied_rules: JSON.stringify(f.applied_rule_ids || []),
        policy_violations: JSON.stringify(f.policy_violations || []),
        explanation: f.explanation || "N/A",
      });

      // Insert Recommendation
      if (f.recommendation) {
        await trx("recommendations").insert({
          id: `rec_${findingId}`,
          scan_id: scanRecord.id,
          finding_id: findingId,
          priority: String(f.recommendation.priority || "medium").slice(0, 50),
          current_state: f.recommendation.current_state || "",
          recommended_target: f.recommendation.recommended_target || "",
          classical_remediation: f.recommendation.classical_remediation,
          pqc_migration: f.recommendation.pqc_migration,
          hybrid_transition_recommended: Boolean(
            f.recommendation.hybrid_transition_recommended,
          ),
          migration_complexity: f.recommendation.migration_complexity
            ? String(f.recommendation.migration_complexity).slice(0, 50)
            : null,
          latency_impact: f.recommendation.latency_impact,
          bandwidth_impact: f.recommendation.bandwidth_impact,
          cost_category: f.recommendation.cost_category,
          rationale: f.recommendation.rationale,
          references: JSON.stringify(f.recommendation.references || []),
          assumptions: JSON.stringify(f.recommendation.assumptions || []),
          benchmark_available: false,
        });
      }
    }

    // 6. Insert Scan Errors / Warnings
    const scanErrors = scanRecord.errors || [];
    for (const err of scanErrors) {
      await trx("scan_errors").insert({
        scan_id: scanRecord.id,
        error_code: err.error_code || "INGESTION_NOTICE",
        message: err.message || "Scan error notice",
        details: JSON.stringify(err.details || {}),
      });
    }
  });

  return true;
}

/**
 * Ingests a CBOM payload, validates structure, runs the Risk Engine,
 * caches results in-memory and persists transactionally to PostgreSQL.
 */
async function ingestCbom(rawInputData, options = {}) {
  // 1. Structural and bounds validation
  const validation = validateCbomStructure(rawInputData, {
    rejectPrivateKey: options.rejectPrivateKey || false,
  });

  if (!validation.valid) {
    const err = new Error(
      `CBOM Ingestion Validation Failed: ${validation.errors.join("; ")}`,
    );
    err.statusCode = 400;
    err.validationErrors = validation.errors;
    throw err;
  }

  // 2. Aggressive Redaction of Private Keys (never persisted in raw or normalized tables)
  const {
    sanitized: sanitizedCbom,
    redactedCount,
    redactedPaths,
  } = redactPrivateKeys(rawInputData);
  const scanErrors = [];

  if (redactedCount > 0) {
    scanErrors.push({
      error_code: "SECURITY_PRIVATE_KEY_REDACTED",
      message: `Detected and redacted ${redactedCount} instance(s) of private-key material. Private keys are never persisted.`,
      details: { redacted_paths: redactedPaths, count: redactedCount },
    });
  }

  if (validation.warnings && validation.warnings.length > 0) {
    for (const w of validation.warnings) {
      scanErrors.push({
        error_code: "VALIDATION_WARNING",
        message: w,
        details: {},
      });
    }
  }

  const policyProfile =
    options.policyProfile ||
    options.policy_profile ||
    config.DEFAULT_POLICY_PROFILE;
  const scenario = options.scenario || config.DEFAULT_SCENARIO;
  const scanId = options.scanId || `scan_${crypto.randomUUID()}`;
  const scanName =
    options.scanName ||
    options.scan_name ||
    options.scanLabel ||
    options.scan_label ||
    `CBOM Scan (${new Date().toLocaleDateString()})`;
  const scannerType = options.scannerType || options.scanner_type || "combined";
  const projectId =
    options.projectId ||
    options.project_id ||
    options.projectName ||
    options.project_name ||
    "default_project";

  // 3. Run Risk Engine Annotation and Executive Summary
  const summary = generateSummary(sanitizedCbom, {
    policyProfile,
    scenario,
  });

  const { annotatedBOM, classifiedResults } = annotateCbom(sanitizedCbom, {
    policyProfile,
    scenario,
  });

  // 4. Generate HTML fallback report
  const htmlReport = generateHtmlReport(summary);

  const tenantId =
    options.tenantId ||
    (options.tenantContext && options.tenantContext.tenantId) ||
    "default-tenant";

  // 5. Assemble Ingested Scan Record
  const scanRecord = {
    id: scanId,
    name: scanName,
    tenantId,
    scanner_type: scannerType,
    project_id: projectId,
    policy_profile: policyProfile,
    scenario: scenario,
    created_at: new Date().toISOString(),
    metrics: summary.metrics,
    summary: summary,
    annotated_bom: annotatedBOM,
    raw_cbom: sanitizedCbom,
    classified_findings: classifiedResults,
    top_risky_assets: summary.top_risky_assets,
    html_report: htmlReport,
    errors: scanErrors,
  };

  // Cache in-memory
  inMemoryScansStore.set(scanId, scanRecord);

  // Record audit log & operational metrics
  try {
    defaultAuditService.logEvent({
      category: AUDIT_CATEGORIES.SCAN,
      action: AUDIT_ACTIONS.SCAN_COMPLETED,
      actor: { id: "scanner-pipeline", username: "scanner", role: "system" },
      tenant: tenantId,
      tenantId: tenantId,
      target: { type: "scan", id: scanId, name: options.scanName || scanId },
      result: AUDIT_STATUSES.SUCCESS,
      status: AUDIT_STATUSES.SUCCESS,
      reason: `Cryptographic scan completed with ${summary.metrics?.total_assets || 0} assets and ${summary.metrics?.total_findings || 0} findings`,
      details: {
        scanId,
        scannerType,
        totalAssets: summary.metrics?.total_assets,
        totalFindings: summary.metrics?.total_findings,
      },
    }).catch(() => {});

    if (Array.isArray(classifiedResults)) {
      for (const finding of classifiedResults) {
        defaultMetricsCollector.recordFinding({
          severity: finding.severity || finding.risk_level,
          quantumRisk:
            finding.quantum_safe === false || finding.mosca_status === "AT_RISK"
              ? "quantum_vulnerable"
              : "quantum_safe",
          riskScore: finding.risk_score || finding.normalized_score,
          moscaHorizon: finding.mosca_horizon || "Y2K_IMMEDIATE",
          algorithmId: finding.algorithm,
        });
      }
    }
  } catch (_metricsErr) {
    // Non-blocking telemetry
  }

  // 6. Persist Transactionally to PostgreSQL
  try {
    await persistScanToPostgres(scanRecord, sanitizedCbom);
  } catch (dbErr) {
    console.error(
      "PostgreSQL persistence error during ingestion:",
      dbErr.message,
    );
    throw dbErr;
  }

  return scanRecord;
}

async function getAllScans(tenantContext = null) {
  const isPlatformAdmin = tenantContext ? Boolean(tenantContext.isPlatformAdmin) : false;
  const targetTenant = tenantContext ? tenantContext.tenantId : null;

  // Anonymous user or principal with no tenant scope receives zero scans
  if (!isPlatformAdmin && !targetTenant) {
    return [];
  }

  const connected = await isDbConnected();
  if (connected) {
    try {
      const hasTenantCol = await db.schema.hasColumn("scans", "tenant_id").catch(() => false);
      if (!hasTenantCol) {
        await db.schema.alterTable("scans", (table) => {
          table.string("tenant_id", 100).defaultTo("default-tenant").index();
        }).catch(() => {});
      }

      let query = db("scans").select("*").orderBy("created_at", "desc");
      if (targetTenant && !isPlatformAdmin) {
        query = query.where({ tenant_id: targetTenant });
      }
      const rows = await query;
      return rows.map((s) => ({
        id: s.id,
        tenantId: s.tenant_id || "default-tenant",
        project_id: s.project_id,
        name: s.target_name,
        scanner_type: s.scanner_type,
        policy_profile: s.policy_profile_id,
        scenario: s.scenario,
        status: s.status,
        created_at: s.created_at,
        metrics: {
          total_assets: s.total_assets,
          total_findings: s.total_findings,
          assets_at_quantum_risk: s.quantum_risk_count,
          severity_counts: {
            critical: s.critical_count,
            high: s.high_count,
            medium: s.medium_count,
            low: s.low_count,
            informational: s.info_count,
          },
          overall_cicd_pass: s.cicd_pass,
        },
      }));
    } catch (_err) {
      // Fallback to in-memory only on query failure
    }
  }

  let all = Array.from(inMemoryScansStore.values());
  if (targetTenant && !isPlatformAdmin) {
    all = all.filter((s) => (s.tenantId || "default-tenant") === targetTenant);
  }

  return all.map((s) => ({
    id: s.id,
    tenantId: s.tenantId || "default-tenant",
    project_id: s.project_id,
    name: s.name,
    scanner_type: s.scanner_type,
    policy_profile: s.policy_profile,
    scenario: s.scenario,
    status: "completed",
    created_at: s.created_at,
    metrics: s.metrics,
  }));
}

async function getScanById(scanId, tenantContext = null) {
  const isPlatformAdmin = tenantContext ? Boolean(tenantContext.isPlatformAdmin) : false;
  const targetTenant = tenantContext ? tenantContext.tenantId : null;

  if (!isPlatformAdmin && !targetTenant) {
    return null;
  }

  const inMem = inMemoryScansStore.get(scanId);
  if (inMem) {
    if (targetTenant && !isPlatformAdmin) {
      const scanTenant = inMem.tenantId || "default-tenant";
      if (scanTenant !== targetTenant) {
        return null;
      }
    }
    return inMem;
  }

  const connected = await isDbConnected();
  if (connected) {
    try {
      let query = db("scans").where({ id: scanId });
      if (targetTenant && !isPlatformAdmin) {
        const hasTenantCol = await db.schema.hasColumn("scans", "tenant_id").catch(() => false);
        if (hasTenantCol) {
          query = query.where({ tenant_id: targetTenant });
        } else {
          return null;
        }
      }
      const scanRow = await query.first();
      const cbomRow = await db("cboms").where({ scan_id: scanId }).first();
      if (scanRow && cbomRow) {
        const annotatedBom =
          typeof cbomRow.annotated_json === "string"
            ? JSON.parse(cbomRow.annotated_json)
            : cbomRow.annotated_json;

        return {
          id: scanRow.id,
          tenantId: scanRow.tenant_id || "default-tenant",
          project_id: scanRow.project_id,
          name: scanRow.target_name,
          scanner_type: scanRow.scanner_type,
          policy_profile: scanRow.policy_profile_id,
          scenario: scanRow.scenario,
          status: scanRow.status,
          created_at: scanRow.created_at,
          completed_at: scanRow.completed_at,
          metrics: {
            total_assets: scanRow.total_assets,
            total_findings: scanRow.total_findings,
            assets_at_quantum_risk: scanRow.quantum_risk_count,
            severity_counts: {
              critical: scanRow.critical_count,
              high: scanRow.high_count,
              medium: scanRow.medium_count,
              low: scanRow.low_count,
              informational: scanRow.info_count,
            },
            overall_cicd_pass: scanRow.cicd_pass,
          },
          annotated_bom: annotatedBom,
        };
      }
    } catch (_err) {
      // fallback
    }
  }

  const scan = inMemoryScansStore.get(scanId);
  if (scan && targetTenant && !isPlatformAdmin) {
    if ((scan.tenantId || "default-tenant") !== targetTenant) {
      return null;
    }
  }
  return scan || null;
}

async function getScanErrors(scanId, tenantContext = null) {
  const scan = await getScanById(scanId, tenantContext);
  if (!scan) return [];

  const connected = await isDbConnected();
  if (connected) {
    try {
      const rows = await db("scan_errors")
        .where({ scan_id: scanId })
        .orderBy("created_at", "asc");
      return rows.map((r) => ({
        id: r.id,
        scan_id: r.scan_id,
        error_code: r.error_code,
        message: r.message,
        details:
          typeof r.details === "string" ? JSON.parse(r.details) : r.details,
        created_at: r.created_at,
      }));
    } catch (_err) {
      // fallback
    }
  }

  return scan?.errors || [];
}

function getLatestScan(tenantContext = null) {
  const isPlatformAdmin = tenantContext ? Boolean(tenantContext.isPlatformAdmin) : false;
  const targetTenant = tenantContext ? tenantContext.tenantId : null;

  let all = Array.from(inMemoryScansStore.values());
  if (targetTenant && !isPlatformAdmin) {
    all = all.filter((s) => (s.tenantId || "default-tenant") === targetTenant);
  }
  if (all.length === 0) return null;
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return all[0];
}

async function clearScans(tenantContext = null) {
  const isPlatformAdmin = tenantContext ? Boolean(tenantContext.isPlatformAdmin) : false;
  const targetTenant = tenantContext ? tenantContext.tenantId : null;

  if (targetTenant && !isPlatformAdmin) {
    for (const [id, s] of inMemoryScansStore.entries()) {
      if ((s.tenantId || "default-tenant") === targetTenant) {
        inMemoryScansStore.delete(id);
      }
    }
    const connected = await isDbConnected();
    if (connected) {
      const hasScansTable = await db.schema.hasTable("scans").catch(() => false);
      if (hasScansTable) {
        try {
          const hasTenantCol = await db.schema.hasColumn("scans", "tenant_id").catch(() => false);
          if (hasTenantCol) {
            await db("scans").where({ tenant_id: targetTenant }).del().catch(() => {});
          }
        } catch (_err) {
          // ignore
        }
      }
    }
    return;
  }

  inMemoryScansStore.clear();
  const connected = await isDbConnected();
  if (connected) {
    const hasScansTable = await db.schema.hasTable("scans").catch(() => false);
    if (!hasScansTable) return;
    try {
      await db("risk_assessments").del().catch(() => {});
      await db("cboms").del().catch(() => {});
      await db("scan_errors").del().catch(() => {});
      await db("findings").del().catch(() => {});
      await db("assets").del().catch(() => {});
      await db("scans").del().catch(() => {});
    } catch (_err) {
      // ignore
    }
  }
}

const cbomIngestionService = {
  ingestCbom,
  getAllScans,
  getScanById,
  getScanErrors,
  getLatestScan,
  clearScans,
  persistScanToPostgres,
  _scans: inMemoryScansStore,
};

module.exports = {
  ingestCbom,
  getAllScans,
  getScanById,
  getScanErrors,
  getLatestScan,
  clearScans,
  persistScanToPostgres,
  inMemoryScansStore,
  cbomIngestionService,
};
