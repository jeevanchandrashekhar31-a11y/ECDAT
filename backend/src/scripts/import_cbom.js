#!/usr/bin/env node

/**
 * CLI Tool: Import CBOM for Demo and Ingestion Pipelines
 *
 * Usage:
 *   npm run import-cbom -- ../artifacts/merged_cbom.json --policy-profile regulated_bfsi --fail-on high
 *   node src/scripts/import_cbom.js <filepath> [--policy-profile <policy>] [--fail-on <gate>]
 */

const fs = require("fs");
const path = require("path");
const { ingestCbom } = require("../services/cbom_ingestion");
const { db } = require("../db/connection");
const { VALID_FAIL_ON, evaluateGate } = require("../risk_engine/gate");

function writeJsonArtifact(outputPath, value, label) {
  if (!outputPath) return;
  const resolvedOutput = path.isAbsolute(outputPath)
    ? outputPath
    : path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  fs.writeFileSync(
    resolvedOutput,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  console.log(`${label}: ${resolvedOutput}`);
}

function requireValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

async function run() {
  const args = process.argv.slice(2);
  let filePath = null;
  let policyProfile = "regulated_bfsi";
  let scenario = "baseline";
  let scanLabel = null;
  let scannerType = "combined";
  let projectName = "demo_project";
  let failOn = "none";
  let summaryOut = null;
  let annotatedOut = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--policy" || arg === "--policy-profile" || arg === "-p") {
      policyProfile = requireValue(args, i, arg);
      i++;
    } else if (arg === "--scenario" || arg === "-s") {
      scenario = requireValue(args, i, arg);
      i++;
    } else if (arg === "--label" || arg === "-l") {
      scanLabel = requireValue(args, i, arg);
      i++;
    } else if (arg === "--scanner") {
      scannerType = requireValue(args, i, arg);
      i++;
    } else if (arg === "--project") {
      projectName = requireValue(args, i, arg);
      i++;
    } else if (arg === "--fail-on") {
      failOn = requireValue(args, i, arg);
      i++;
    } else if (arg === "--summary-out") {
      summaryOut = requireValue(args, i, arg);
      i++;
    } else if (arg === "--annotated-out") {
      annotatedOut = requireValue(args, i, arg);
      i++;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!arg.startsWith("-") && !filePath) {
      filePath = arg;
    }
  }

  if (!VALID_FAIL_ON.includes(failOn)) {
    throw new Error(
      `Unsupported --fail-on value '${failOn}'. Choose from: ${VALID_FAIL_ON.join(", ")}`,
    );
  }

  if (!filePath) {
    // Default demo fallback path
    filePath = path.resolve(__dirname, "../../../artifacts/merged_cbom.json");
  }

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  console.log(`\n======================================================`);
  console.log(`  ECDAT CBOM Ingestion CLI`);
  console.log(`======================================================`);
  console.log(`File:     ${resolvedPath}`);
  console.log(`Policy:   ${policyProfile}`);
  console.log(`Scenario: ${scenario}`);
  console.log(`------------------------------------------------------`);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`\n[ERROR] File not found: ${resolvedPath}\n`);
    process.exit(1);
  }

  let fileContent;
  let cbomData;
  try {
    fileContent = fs.readFileSync(resolvedPath, "utf8");
    cbomData = JSON.parse(fileContent);
  } catch (err) {
    console.error(
      `\n[ERROR] Failed to read or parse CBOM JSON: ${err.message}\n`,
    );
    process.exit(1);
  }

  try {
    const label = scanLabel || `Demo Import: ${path.basename(resolvedPath)}`;
    const scanRecord = await ingestCbom(cbomData, {
      policyProfile,
      scenario,
      scanName: label,
      scannerType,
      projectName,
    });

    const m = scanRecord.metrics;
    console.log(`\n[SUCCESS] Ingestion Complete!`);
    console.log(`Scan ID:       ${scanRecord.id}`);
    console.log(`Target:        ${scanRecord.name}`);
    const gate = evaluateGate(scanRecord.summary, failOn);
    console.log(
      `CI/CD Status:  ${gate.matched ? "FAIL (Explicit Gate Exceeded)" : "PASS (Explicit Gate Clear)"}`,
    );
    console.log(`Total Assets:  ${m.total_assets}`);
    console.log(`Total Findings:${m.total_findings}`);
    console.log(`  - Critical:  ${m.severity_counts.critical}`);
    console.log(`  - High:      ${m.severity_counts.high}`);
    console.log(`  - Medium:    ${m.severity_counts.medium}`);
    console.log(`  - Low:       ${m.severity_counts.low}`);
    console.log(`  - Info:      ${m.severity_counts.informational}`);
    console.log(
      `Quantum Risk:  ${m.assets_at_quantum_risk} asset(s) at quantum threat`,
    );

    if (scanRecord.errors && scanRecord.errors.length > 0) {
      console.log(`\nNotices/Errors (${scanRecord.errors.length}):`);
      for (const err of scanRecord.errors) {
        console.log(`  - [${err.error_code}] ${err.message}`);
      }
    }

    // Write artifacts before setting a failure status so CI retains evidence.
    writeJsonArtifact(summaryOut, scanRecord.summary, "Wrote summary");
    writeJsonArtifact(
      annotatedOut,
      scanRecord.annotated_bom,
      "Wrote annotated CBOM",
    );

    if (gate.matched) {
      console.error(`[GATE FAILED] --fail-on ${failOn}: ${gate.reason}`);
      process.exitCode = 1;
    } else {
      console.log(`[GATE PASSED] --fail-on ${failOn}: ${gate.reason}`);
    }

    console.log(`======================================================\n`);
  } catch (err) {
    console.error(`\n[ERROR] Ingestion failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    try {
      await db.destroy();
    } catch (_err) {
      // ignore
    }
  }
}

run().catch((err) => {
  console.error(`\n[ERROR] Import failed: ${err.message}\n`);
  process.exitCode = 1;
});
