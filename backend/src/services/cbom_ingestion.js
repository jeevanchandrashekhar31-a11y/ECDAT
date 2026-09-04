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

  await db.transaction(async (trx) => {
    // 1. Delete prior record if re-running scan with same ID (prevents duplicates)
    await trx("scans").where({ id: scanRecord.id }).del();

    // 2. Insert Scan record
    await trx("scans").insert({
      id: scanRecord.id,
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
    });

    // 3. Insert CBOM (raw and annotated - both guaranteed free of private keys)
    await trx("cboms").insert({
      id: `cbom_${scanRecord.id}`,
      scan_id: scanRecord.id,
      raw_json: JSON.stringify(rawCbom || {}),
      annotated_json: JSON.stringify(scanRecord.annotated_bom || {}),
      spec_version: "1.6",
      bom_format: "CycloneDX",
    });

    // 4. Insert Assets
    const topAssets = scanRecord.top_risky_assets || [];
    for (const asset of topAssets) {
      await trx("assets").insert({
        scan_id: scanRecord.id,
        id: asset.asset_id,
        primary_identifier: asset.asset_id,
        asset_type: asset.asset_type || "network_session",
        data_sensitivity: asset.data_sensitivity || "internal",
        business_criticality: asset.business_criticality || "medium",
        highest_severity: asset.severity || "Informational",
        at_quantum_risk:
          asset.mosca_status === "AT_RISK" ||
          asset.mosca_status === "CRITICAL_URGENT",
        cicd_pass: asset.cicd_pass !== false,
        metadata: JSON.stringify(asset),
      });
    }

    // 5. Insert Findings & Risk Assessments
    const findings = scanRecord.classified_findings || [];
    for (let i = 0; i < findings.length; i++) {
      const f = findings[i];
      const findingId = `fnd_${scanRecord.id}_${i}`;
      const compId = f.bom_ref || `comp_${scanRecord.id}_${i}`;
      const assetId = f.asset_id || f.bom_ref || "global";

      // Ensure asset row exists
      const assetRow = await trx("assets")
        .where({ scan_id: scanRecord.id, id: assetId })
        .first();
      if (!assetRow) {
        await trx("assets").insert({
          scan_id: scanRecord.id,
          id: assetId,
          primary_identifier: assetId,
          asset_type: f.asset_type || "network_session",
          data_sensitivity: f.data_sensitivity || "internal",
          business_criticality: f.business_criticality || "medium",
          highest_severity: f.severity || "Informational",
          at_quantum_risk:
            f.mosca?.status === "AT_RISK" ||
            f.mosca?.status === "CRITICAL_URGENT",
          cicd_pass: f.cicd_pass !== false,
          metadata: JSON.stringify({ asset_id: assetId }),
        });
      }

      // Ensure component row exists
      const compRow = await trx("components")
        .where({ scan_id: scanRecord.id, id: compId })
        .first();
      if (!compRow) {
        await trx("components").insert({
          scan_id: scanRecord.id,
          id: compId,
          asset_id: assetId,
          name: f.algorithm || "crypto-asset",
          component_type:
            f.asset_type === "library_presence"
              ? "library"
              : "cryptographic-asset",
          version: f.version || null,
        });
      }

      // Insert Finding
      await trx("findings").insert({
        id: findingId,
        scan_id: scanRecord.id,
        component_id: compId,
        asset_id: assetId,
        algorithm: f.algorithm,
        key_size: f.key_size || null,
        category: f.category || null,
        finding_type: f.asset_type || null,
        location: f.file_path || f.location || null,
        line_number: f.line_number ? parseInt(f.line_number, 10) : null,
        evidence_context: f.raw_evidence
          ? JSON.stringify(f.raw_evidence)
          : null,
        confidence: f.confidence || "high",
      });

      // Insert Risk Assessment
      await trx("risk_assessments").insert({
        id: `ra_${findingId}`,
        finding_id: findingId,
        scan_id: scanRecord.id,
        severity: f.severity,
        classical_risk: f.classical_risk,
        quantum_relevance: f.quantum_relevance,
        mosca_status: f.mosca?.status || "SAFE",
        mosca_x_years: f.mosca?.final_values?.X_shelf_life_years || 0,
        mosca_y_years: f.mosca?.final_values?.Y_migration_years || 0,
        mosca_z_years: f.mosca?.final_values?.Z_quantum_threat_years || 9,
        mosca_margin_years: f.mosca?.mosca_margin_years || 0,
        cicd_pass: f.cicd_pass,
        applied_rules: JSON.stringify(f.applied_rule_ids || []),
        policy_violations: JSON.stringify(f.policy_violations || []),
        explanation: f.explanation,
      });

      // Insert Recommendation
      if (f.recommendation) {
        await trx("recommendations").insert({
          id: `rec_${findingId}`,
          scan_id: scanRecord.id,
          finding_id: findingId,
          priority: f.recommendation.priority || "medium",
          current_state: f.recommendation.current_state,
          recommended_target: f.recommendation.recommended_target,
          classical_remediation: f.recommendation.classical_remediation,
          pqc_migration: f.recommendation.pqc_migration,
          hybrid_transition_recommended: Boolean(
            f.recommendation.hybrid_transition_recommended,
          ),
          migration_complexity: f.recommendation.migration_complexity,
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

  // 5. Assemble Ingested Scan Record
  const scanRecord = {
    id: scanId,
    name: scanName,
    scanner_type: scannerType,
    project_id: projectId,
    policy_profile: policyProfile,
    scenario: scenario,
    created_at: new Date().toISOString(),
    metrics: summary.metrics,
    summary: summary,
    annotated_bom: annotatedBOM,
    classified_findings: classifiedResults,
    top_risky_assets: summary.top_risky_assets,
    html_report: htmlReport,
    errors: scanErrors,
  };

  // Cache in-memory
  inMemoryScansStore.set(scanId, scanRecord);

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

async function getAllScans() {
  const connected = await isDbConnected();
  if (connected) {
    try {
      const rows = await db("scans").select("*").orderBy("created_at", "desc");
      if (rows.length > 0) {
        return rows.map((s) => ({
          id: s.id,
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
      }
    } catch (_err) {
      // Fallback to in-memory
    }
  }

  return Array.from(inMemoryScansStore.values()).map((s) => ({
    id: s.id,
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

async function getScanById(scanId) {
  const inMem = inMemoryScansStore.get(scanId);
  if (inMem) {
    return inMem;
  }

  const connected = await isDbConnected();
  if (connected) {
    try {
      const scanRow = await db("scans").where({ id: scanId }).first();
      const cbomRow = await db("cboms").where({ scan_id: scanId }).first();
      if (scanRow && cbomRow) {
        const annotatedBom =
          typeof cbomRow.annotated_json === "string"
            ? JSON.parse(cbomRow.annotated_json)
            : cbomRow.annotated_json;

        return {
          id: scanRow.id,
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

  return inMemoryScansStore.get(scanId) || null;
}

async function getScanErrors(scanId) {
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

  const scan = inMemoryScansStore.get(scanId);
  return scan?.errors || [];
}

function getLatestScan() {
  const all = Array.from(inMemoryScansStore.values());
  if (all.length === 0) return null;
  all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return all[0];
}

function clearScans() {
  inMemoryScansStore.clear();
}

module.exports = {
  ingestCbom,
  getAllScans,
  getScanById,
  getScanErrors,
  getLatestScan,
  clearScans,
  persistScanToPostgres,
};
