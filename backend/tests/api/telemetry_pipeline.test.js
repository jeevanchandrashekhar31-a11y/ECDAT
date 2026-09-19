const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const app = require("../../src/app");
const config = require("../../src/config");

describe("Phase 7: eBPF Telemetry Ingestion Pipeline (P1-05, P1-06, P1-07)", () => {
  let server;
  let baseUrl;
  const testApiKey = "ecdat-test-telemetry-key-2026";

  before(async () => {
    config.ECDAT_API_KEY = testApiKey;
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("P1-06: POST /api/v1/telemetry/ebpf rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/ebpf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: [{ crypto_operation: "symmetric_encryption" }] }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, "Unauthorized");
  });

  test("P1-06: POST /api/v1/telemetry/ebpf accepts valid metadata-only telemetry when authenticated", async () => {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/ebpf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": testApiKey,
      },
      body: JSON.stringify({
        node_id: "worker-node-alpha",
        events: [
          {
            process_id: 1234,
            process_name: "nginx",
            crypto_operation: "symmetric_encryption",
            parameters: {
              algorithm_name: "AES-256-GCM",
              key_size_bits: 256,
              return_code: 1,
            },
          },
        ],
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.status, "INGESTED");
    assert.equal(data.ingested_events, 1);
  });

  test("P1-06: POST /api/v1/telemetry/ebpf rejects forbidden raw key material with 400", async () => {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/ebpf`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": testApiKey,
      },
      body: JSON.stringify({
        node_id: "worker-node-bad",
        events: [
          {
            process_id: 9999,
            crypto_operation: "leakage_attempt",
            parameters: {
              algorithm_name: "RSA",
              raw_key_bytes: "0102030405060708",
            },
          },
        ],
      }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /Security boundary rejection/);
  });

  test("P1-05: GET /api/v1/telemetry/ebpf returns truthful status (is_kernel_ebpf_proven: false)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/ebpf`, {
      headers: { "x-api-key": testApiKey },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.is_kernel_ebpf_proven, false);
    assert.equal(data.service, "ecdat-ebpf-telemetry-ingestion");
  });

  test("P1-05/P1-07: GET /api/v1/telemetry/status declares truthful least-privilege boundary", async () => {
    const res = await fetch(`${baseUrl}/api/v1/telemetry/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.is_live_ebpf_verified, false);
    assert.equal(data.security_boundary.least_privilege_enforced, true);
    assert.deepEqual(data.security_boundary.capabilities_dropped, ["ALL", "SYS_ADMIN", "NET_ADMIN"]);
  });
});
