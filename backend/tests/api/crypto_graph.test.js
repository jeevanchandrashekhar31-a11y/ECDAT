process.env.NODE_ENV = "test";
const test = require("node:test");
const assert = require("node:assert");
const app = require("../../src/app");
const config = require("../../src/config");
const { sanitizeGraphLabel } = require("../../src/services/crypto_graph_service");

const AUTH_HEADERS = { "X-API-Key": config.ECDAT_API_KEY, "X-User-Role": "admin" };

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.closeAllConnections?.();
        server.close(resolve);
      } catch (err) {
        server.closeAllConnections?.();
        server.close(() => reject(err));
      }
    });
  });
}

test("Phase 17.2 — Crypto Graph Relationship Visualization API", async (t) => {
  await t.test("sanitizeGraphLabel neutralizes private keys, credentials, and raw secrets", () => {
    const rawKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----";
    const sanitizedKey = sanitizeGraphLabel(rawKey);
    assert.strictEqual(sanitizedKey.includes("BEGIN RSA PRIVATE KEY"), false);
    assert.strictEqual(sanitizedKey.includes("[PRIVATE_KEY_REDACTED]"), true);

    const credentialString = "password=superSecret123 token=eyJhbGciOi";
    const sanitizedCred = sanitizeGraphLabel(credentialString);
    assert.strictEqual(sanitizedCred.includes("superSecret123"), false);
    assert.strictEqual(sanitizedCred.includes("[REDACTED]"), true);

    const longHex = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef";
    const sanitizedHex = sanitizeGraphLabel(longHex);
    assert.strictEqual(sanitizedHex.includes("..."), true);
  });

  await t.test("GET /api/v1/graph returns correlated 6-tier graph structure", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/graph`, { headers: AUTH_HEADERS });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.ok(data.graph, "data.graph must be present");
      assert.ok(Array.isArray(data.graph.nodes), "nodes array must be present");
      assert.ok(Array.isArray(data.graph.edges), "edges array must be present");
      assert.ok(data.graph.nodes.length > 0, "nodes must not be empty");
      assert.ok(data.graph.edges.length > 0, "edges must not be empty");

      // Verify all 6 tiers exist in graph
      const tiers = new Set(data.graph.nodes.map((n) => n.tier)); console.log('TIERS:', Array.from(tiers));
      assert.ok(tiers.has("Application"), "Graph must have Application nodes");
      assert.ok(tiers.has("Service"), "Graph must have Service nodes");
      assert.ok(tiers.has("Certificate"), "Graph must have Certificate nodes");
      assert.ok(tiers.has("Protocol"), "Graph must have Protocol nodes");
      assert.ok(tiers.has("Algorithm"), "Graph must have Algorithm nodes");
      assert.ok(tiers.has("Data"), "Graph must have Data nodes");

      // Verify label sanitization on all nodes
      for (const node of data.graph.nodes) {
        assert.ok(node.label, "Node must have a label");
        assert.ok(!node.label.includes("BEGIN"), "No private key headers in node labels");
        assert.ok(!node.label.includes("password="), "No plaintext passwords in node labels");
      }

      // Verify filter metadata catalog is returned
      assert.ok(data.filter_metadata, "filter_metadata must be returned");
      assert.ok(Array.isArray(data.filter_metadata.severities));
      assert.ok(Array.isArray(data.filter_metadata.owners));
      assert.ok(Array.isArray(data.filter_metadata.environments));
      assert.ok(Array.isArray(data.filter_metadata.algorithms));
      assert.ok(Array.isArray(data.filter_metadata.pqc_statuses));
      assert.ok(Array.isArray(data.filter_metadata.exposures));

      // Verify evidence lookup dictionary is present
      assert.ok(data.evidence_lookup, "evidence_lookup must be returned");
      assert.ok(Object.keys(data.evidence_lookup).length > 0);
    });
  });

  await t.test("GET /api/v1/graph filters by severity, owner, algorithm, and pqcReadiness", async () => {
    await withServer(async (baseUrl) => {
      // 1. Severity filter
      const resSev = await fetch(`${baseUrl}/api/v1/graph?severity=Critical`, { headers: AUTH_HEADERS });
      assert.strictEqual(resSev.status, 200);
      const dataSev = await resSev.json();
      for (const node of dataSev.graph.nodes) {
        assert.strictEqual(node.severity, "Critical");
      }

      // 2. Owner filter
      const resOwner = await fetch(`${baseUrl}/api/v1/graph?owner=Fintech%20Core%20Team`, { headers: AUTH_HEADERS });
      assert.strictEqual(resOwner.status, 200);
      const dataOwner = await resOwner.json();
      for (const node of dataOwner.graph.nodes) {
        assert.strictEqual(node.owner, "Fintech Core Team");
      }

      // 3. Algorithm filter
      const resAlgo = await fetch(`${baseUrl}/api/v1/graph?algorithm=RSA`, { headers: AUTH_HEADERS });
      assert.strictEqual(resAlgo.status, 200);
      const dataAlgo = await resAlgo.json();
      for (const node of dataAlgo.graph.nodes) {
        assert.ok(node.algorithm.includes("RSA"), `Node algorithm ${node.algorithm} must contain RSA`);
      }

      // 4. PQC Readiness filter
      const resPqc = await fetch(`${baseUrl}/api/v1/graph?pqcReadiness=SAFE`, { headers: AUTH_HEADERS });
      assert.strictEqual(resPqc.status, 200);
      const dataPqc = await resPqc.json();
      for (const node of dataPqc.graph.nodes) {
        assert.strictEqual(node.pqc_readiness, "SAFE");
      }

      // 5. Exposure filter
      const resExp = await fetch(`${baseUrl}/api/v1/graph?exposure=external`, { headers: AUTH_HEADERS });
      assert.strictEqual(resExp.status, 200);
      const dataExp = await resExp.json();
      for (const node of dataExp.graph.nodes) {
        assert.strictEqual(node.exposure, "external");
      }
    });
  });
});

test.after(async () => {
  const { db } = require("../../src/db/connection");
  await db.destroy();
});
