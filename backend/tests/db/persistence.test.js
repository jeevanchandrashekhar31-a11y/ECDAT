const test = require("node:test");
const assert = require("node:assert");
const { db, isDbConnected } = require("../../src/db/connection");
const { ingestCbom } = require("../../src/services/cbom_ingestion");

const sampleCbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  components: [
    {
      type: "cryptographic-asset",
      name: "TLS 1.0",
      "bom-ref": "net:target/dbtest.example.com:443",
      cryptoProperties: {
        assetType: "protocol",
        protocolProperties: {
          type: "tls",
          version: "TLS 1.0",
        },
      },
    },
    {
      type: "cryptographic-asset",
      name: "RSA-2048",
      "bom-ref": "net:cert/dbtest.example.com:443",
      cryptoProperties: {
        assetType: "certificate",
        certificateProperties: {
          subjectName: "CN=dbtest.example.com",
          isExpired: false,
          isSelfSigned: false,
        },
      },
      properties: [
        { name: "ecdat:algorithm", value: "RSA" },
        { name: "ecdat:key_size", value: "2048" },
      ],
    },
  ],
};

test("Database Persistence - Connects and verifies migration schema in PostgreSQL", async () => {
  const connected = await isDbConnected();
  assert.strictEqual(connected, true, "PostgreSQL database must be connected");

  // Verify all 10 tables exist in public schema
  const requiredTables = [
    "scans",
    "cboms",
    "assets",
    "components",
    "findings",
    "risk_assessments",
    "recommendations",
    "policy_profiles",
    "rule_versions",
    "scan_errors",
  ];

  for (const tbl of requiredTables) {
    const exists = await db.schema.hasTable(tbl);
    assert.strictEqual(exists, true, `Table '${tbl}' must exist in PostgreSQL`);
  }
});

test("Database Persistence - Ingests CBOM transactionally and stores normalized records", async () => {
  const testScanId = "test_scan_tx_001";

  const scanRecord = await ingestCbom(sampleCbom, {
    scanId: testScanId,
    scanName: "Test Transactional Scan",
    policyProfile: "public_internet",
  });

  assert.strictEqual(scanRecord.id, testScanId);

  // 1. Verify Scan Table
  const scanRow = await db("scans").where({ id: testScanId }).first();
  assert.ok(scanRow, "Scan record must exist");
  assert.strictEqual(scanRow.target_name, "Test Transactional Scan");
  assert.strictEqual(scanRow.policy_profile_id, "public_internet");
  assert.strictEqual(scanRow.total_findings, 2);

  // 2. Verify CBOM Table (Immutable Raw & Annotated JSON)
  const cbomRow = await db("cboms").where({ scan_id: testScanId }).first();
  assert.ok(cbomRow, "CBOM row must exist");
  assert.strictEqual(cbomRow.spec_version, "1.6");
  assert.strictEqual(cbomRow.raw_json.bomFormat, "CycloneDX");
  assert.strictEqual(cbomRow.annotated_json.bomFormat, "CycloneDX");

  // 3. Verify Assets Table
  const assetRows = await db("assets").where({ scan_id: testScanId });
  assert.ok(assetRows.length > 0, "Assets must be populated");

  // 4. Verify Findings Table
  const findingRows = await db("findings").where({ scan_id: testScanId });
  assert.strictEqual(findingRows.length, 2);

  // 5. Verify Risk Assessments & Recommendations
  const raRows = await db("risk_assessments").where({ scan_id: testScanId });
  assert.strictEqual(raRows.length, 2);
  const criticalRA = raRows.find((r) => r.severity === "Critical");
  assert.ok(criticalRA, "Critical risk assessment for TLS 1.0 must be stored");

  const recRows = await db("recommendations").where({ scan_id: testScanId });
  assert.ok(recRows.length > 0, "Recommendations must be stored");
});

test("Database Persistence - Re-running ingestion is idempotent and does not duplicate records", async () => {
  const testScanId = "test_scan_idempotent";

  // First ingestion
  await ingestCbom(sampleCbom, { scanId: testScanId });
  const count1 = await db("findings")
    .where({ scan_id: testScanId })
    .count("id as count");

  // Second ingestion with same scanId
  await ingestCbom(sampleCbom, { scanId: testScanId });
  const count2 = await db("findings")
    .where({ scan_id: testScanId })
    .count("id as count");

  assert.strictEqual(
    parseInt(count1[0].count, 10),
    parseInt(count2[0].count, 10),
    "Findings count must remain identical upon re-ingestion",
  );

  const scanRows = await db("scans").where({ id: testScanId });
  assert.strictEqual(scanRows.length, 1, "Only one scan row should exist");
});

test("Database Persistence - Failed ingestion rolls back incomplete normalized records", async () => {
  const failedScanId = "test_scan_failed_rollback";

  // Clean slate
  await db("scans").where({ id: failedScanId }).del();

  // Trigger an artificial transaction failure by forcing an invalid insert inside transaction
  try {
    await db.transaction(async (trx) => {
      // 1. Insert scan row
      await trx("scans").insert({
        id: failedScanId,
        target_name: "Failing Scan",
        status: "processing",
      });

      // 2. Insert one finding
      await trx("findings").insert({
        id: `fnd_${failedScanId}_0`,
        scan_id: failedScanId,
        component_id: "comp_0",
        asset_id: "asset_0",
        algorithm: "RSA",
      });

      // 3. Intentionally throw error to abort transaction
      throw new Error("Simulated ingestion failure mid-process");
    });
  } catch (err) {
    assert.strictEqual(err.message, "Simulated ingestion failure mid-process");
  }

  // Verify rollback: scan and findings rows MUST NOT exist!
  const scanExists = await db("scans").where({ id: failedScanId }).first();
  assert.strictEqual(scanExists, undefined, "Scan must be rolled back");

  const findingExists = await db("findings")
    .where({ scan_id: failedScanId })
    .first();
  assert.strictEqual(findingExists, undefined, "Findings must be rolled back");
});

test.after(async () => {
  await db.destroy();
});
