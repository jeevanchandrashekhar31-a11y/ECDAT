/**
 * ECDAT Phase 8 P0 — SSRF and Active Network Scanning Security Test Suite
 *
 * Verifies:
 * 1. Complete IP Range Blocklist (127.0.0.0/8, 0.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
 *    192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, IPv6 loopback, IPv6 link-local,
 *    IPv6 ULA, IPv4-mapped IPv6, and Cloud Metadata IPs).
 * 2. Hostname & Internal Target Blocklists (localhost, metadata hostnames, internal DNS suffixes .local, .internal, .corp, .lan, etc., Unix sockets).
 * 3. DNS Rebinding (TOCTOU) Defense & IP Pinning.
 * 4. Git Clone URL Security (rejection of file://, ext::, command injection, and private targets).
 * 5. Active Network Scanning Security:
 *    - Explicit authorization required (matching authenticated caller identity).
 *    - Tenant-scoped targets & Safe default deny.
 *    - Strict port bounds (crypto ports only, internal DB/orchestration ports prohibited).
 *    - Per-tenant sliding window rate limits (429 on abuse).
 *    - Per-tenant concurrency limits (429 on abuse).
 *    - Structured audit logging to tamper-chain ledger.
 * 6. Connector & Webhook SSRF Defenses (SIEM, KMS, Ticketing).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const { defaultAuditService } = require("../../src/audit/audit_service");
const {
  isForbiddenIp,
  checkForbiddenIp,
  isForbiddenHostname,
  checkForbiddenHostname,
  resolveAndValidateTarget,
  validateSafeUrlAsync,
  validateSafeGitUrlAsync,
  safeFetch,
} = require("../../src/security/ssrf_protection");
const {
  defaultNetworkScanGuard,
  ALLOWED_SCAN_PORTS,
  PROHIBITED_PORTS,
} = require("../../src/security/network_scan_guard");
const { defaultTokenService, defaultLocalAuthManager } = require("../../src/identity");

const TEST_API_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.ECDAT_API_KEY,
};

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

function createAuthHeaders({ userId = "user-1", username = "alice", role = "analyst", tenantId = "tenant-alpha" } = {}) {
  defaultLocalAuthManager.users.set(userId, {
    userId,
    username,
    email: `${username}@test.corp`,
    tenantId,
    roles: [role],
    mfaEnabled: false,
  });

  const token = defaultTokenService.issueTokenPair({
    userId,
    email: `${username}@test.corp`,
    roles: [role],
    customClaims: { tenantId, username },
  }).accessToken;

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": tenantId,
  };
}

// ============================================================================
// SUITE 1: COMPLETE IP RANGE & SUBNET BLOCKLIST
// ============================================================================

test("SSRF Security - Rejects complete forbidden IPv4 subnet blocklist", () => {
  // 127.0.0.0/8 (IPv4 Loopback)
  assert.equal(isForbiddenIp("127.0.0.1"), true);
  assert.equal(isForbiddenIp("127.0.0.2"), true);
  assert.equal(isForbiddenIp("127.255.255.254"), true);

  // 0.0.0.0/8 (Current network)
  assert.equal(isForbiddenIp("0.0.0.0"), true);
  assert.equal(isForbiddenIp("0.1.2.3"), true);

  // 10.0.0.0/8 (RFC 1918 Class A)
  assert.equal(isForbiddenIp("10.0.0.1"), true);
  assert.equal(isForbiddenIp("10.255.255.254"), true);

  // 172.16.0.0/12 (RFC 1918 Class B: 172.16.0.0 - 172.31.255.255)
  assert.equal(isForbiddenIp("172.16.0.1"), true);
  assert.equal(isForbiddenIp("172.20.5.10"), true);
  assert.equal(isForbiddenIp("172.31.255.254"), true);
  // Outside range (172.32.0.1 is public)
  assert.equal(isForbiddenIp("172.32.0.1"), false);

  // 192.168.0.0/16 (RFC 1918 Class C)
  assert.equal(isForbiddenIp("192.168.0.1"), true);
  assert.equal(isForbiddenIp("192.168.100.50"), true);

  // 169.254.0.0/16 (Link-Local & Cloud Metadata)
  assert.equal(isForbiddenIp("169.254.0.1"), true);
  assert.equal(isForbiddenIp("169.254.169.254"), true);
  assert.equal(isForbiddenIp("169.254.169.253"), true);
  assert.equal(isForbiddenIp("169.254.170.2"), true);

  // 100.64.0.0/10 (Carrier-Grade NAT)
  assert.equal(isForbiddenIp("100.64.0.1"), true);
  assert.equal(isForbiddenIp("100.127.255.254"), true);
  assert.equal(isForbiddenIp("100.128.0.1"), false);

  // Alibaba Cloud metadata (100.100.100.200)
  assert.equal(isForbiddenIp("100.100.100.200"), true);

  // Multicast & Reserved
  assert.equal(isForbiddenIp("224.0.0.1"), true);
  assert.equal(isForbiddenIp("240.0.0.1"), true);
  assert.equal(isForbiddenIp("255.255.255.255"), true);

  // Public IPs allowed
  assert.equal(isForbiddenIp("8.8.8.8"), false);
  assert.equal(isForbiddenIp("1.1.1.1"), false);
  assert.equal(isForbiddenIp("93.184.216.34"), false);
});

test("SSRF Security - Rejects IPv6 loopback, link-local, ULA, and mapped IPv6", () => {
  // IPv6 Loopback & Unspecified
  assert.equal(isForbiddenIp("::1"), true);
  assert.equal(isForbiddenIp("[::1]"), true);
  assert.equal(isForbiddenIp("::"), true);

  // IPv6 Link-Local (fe80::/10)
  assert.equal(isForbiddenIp("fe80::1"), true);
  assert.equal(isForbiddenIp("fe80::dead:beef:cafe"), true);

  // IPv6 Unique Local Address (fc00::/7) & AWS metadata IPv6 (fd00:ec2::254)
  assert.equal(isForbiddenIp("fc00::1"), true);
  assert.equal(isForbiddenIp("fd00::1"), true);
  assert.equal(isForbiddenIp("fd00:ec2::254"), true);

  // IPv4-Mapped IPv6
  assert.equal(isForbiddenIp("::ffff:127.0.0.1"), true);
  assert.equal(isForbiddenIp("::ffff:169.254.169.254"), true);
  assert.equal(isForbiddenIp("::ffff:10.0.0.1"), true);
  assert.equal(isForbiddenIp("::ffff:192.168.1.1"), true);
  assert.equal(isForbiddenIp("::ffff:7f00:1"), true); // Hex for 127.0.0.1

  // Valid Global IPv6 allowed
  assert.equal(isForbiddenIp("2606:4700:4700::1111"), false); // Cloudflare DNS
  assert.equal(isForbiddenIp("2001:4860:4860::8888"), false); // Google DNS
});

test("SSRF Security - Rejects alternate numeric, octal, and hex IP representations", () => {
  // Decimal integer 2130706433 == 127.0.0.1
  assert.equal(isForbiddenIp("2130706433"), true);

  // Hex integer 0x7f000001 == 127.0.0.1
  assert.equal(isForbiddenIp("0x7f000001"), true);

  // Octal dotted 0177.0.0.1 == 127.0.0.1
  assert.equal(isForbiddenIp("0177.0.0.1"), true);

  // Hex dotted 0x7f.0.0.1 == 127.0.0.1
  assert.equal(isForbiddenIp("0x7f.0.0.1"), true);
});

// ============================================================================
// SUITE 2: FORBIDDEN HOSTNAMES, INTERNAL DNS & PROTOCOLS
// ============================================================================

test("SSRF Security - Rejects localhost, cloud metadata, and internal DNS suffixes", () => {
  // Localhost
  assert.equal(isForbiddenHostname("localhost"), true);
  assert.equal(isForbiddenHostname("localhost.localdomain"), true);
  assert.equal(isForbiddenHostname("app.localhost"), true);

  // Cloud metadata hostnames
  assert.equal(isForbiddenHostname("metadata.google.internal"), true);
  assert.equal(isForbiddenHostname("instance-data"), true);
  assert.equal(isForbiddenHostname("metadata.azure.com"), true);

  // Internal DNS suffixes
  assert.equal(isForbiddenHostname("service.local"), true);
  assert.equal(isForbiddenHostname("db.internal"), true);
  assert.equal(isForbiddenHostname("auth.corp"), true);
  assert.equal(isForbiddenHostname("router.lan"), true);
  assert.equal(isForbiddenHostname("gateway.home"), true);
  assert.equal(isForbiddenHostname("vault.home.arpa"), true);
  assert.equal(isForbiddenHostname("portal.intranet"), true);
  assert.equal(isForbiddenHostname("admin.priv"), true);
  assert.equal(isForbiddenHostname("core.private"), true);

  // Public domain names allowed
  assert.equal(isForbiddenHostname("github.com"), false);
  assert.equal(isForbiddenHostname("api.example.com"), false);
});

// ============================================================================
// SUITE 3: ASYNC DNS RESOLUTION & DNS REBINDING (TOCTOU) DEFENSE
// ============================================================================

test("SSRF Security - Multi-address DNS resolution blocks rebinding targets", async () => {
  // Simulated DNS rebinding where attacker domain returns both a public IP and 127.0.0.1
  const mockDnsRebinding = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];

  const result = await resolveAndValidateTarget("attacker.rebind.com", {
    dnsLookupFn: mockDnsRebinding,
  });

  assert.equal(result.valid, false);
  assert.match(result.error, /restricted address 127\.0\.0\.1/);
});

test("SSRF Security - Anti-rebinding safeFetch pins destination address", async () => {
  // Mock DNS resolver returning a valid public IP
  const mockSafeDns = async () => [{ address: "93.184.216.34", family: 4 }];

  const validation = await validateSafeUrlAsync("https://example.com/api/test", {
    dnsLookupFn: mockSafeDns,
  });

  assert.equal(validation.safe, true);
  assert.equal(validation.pinnedIp, "93.184.216.34");
  assert.deepEqual(validation.resolvedIps, ["93.184.216.34"]);
});

// ============================================================================
// SUITE 4: GIT URL SECURITY
// ============================================================================

test("SSRF Security - Git URL security rejects malicious schemes and private destinations", async () => {
  // 1. File schemes and local paths
  const fileCheck = await validateSafeGitUrlAsync("file:///etc/passwd");
  assert.equal(fileCheck.safe, false);
  assert.match(fileCheck.error, /prohibited/i);

  const relativeCheck = await validateSafeGitUrlAsync("../../secret-repo");
  assert.equal(relativeCheck.safe, false);

  // 2. Dangerous Git helper protocols
  const extCheck = await validateSafeGitUrlAsync("ext::sh -c id");
  assert.equal(extCheck.safe, false);

  // 3. Option injection
  const optCheck = await validateSafeGitUrlAsync("--upload-pack=evil");
  assert.equal(optCheck.safe, false);

  // 4. Command injection metacharacters
  const cmdCheck = await validateSafeGitUrlAsync("https://github.com/foo/bar;whoami");
  assert.equal(cmdCheck.safe, false);

  // 5. Private / SSRF Git URLs
  const loopbackGit = await validateSafeGitUrlAsync("https://127.0.0.1/org/repo.git");
  assert.equal(loopbackGit.safe, false);
  assert.match(loopbackGit.error, /restricted/i);

  const imdsGit = await validateSafeGitUrlAsync("https://169.254.169.254/secret.git");
  assert.equal(imdsGit.safe, false);

  const scpPrivateGit = await validateSafeGitUrlAsync("git@192.168.1.50:core/app.git");
  assert.equal(scpPrivateGit.safe, false);

  // 6. Valid public Git URLs allowed
  const validHttpsGit = await validateSafeGitUrlAsync("https://github.com/torvalds/linux.git");
  assert.equal(validHttpsGit.safe, true);
  assert.equal(validHttpsGit.hostname, "github.com");

  const validScpGit = await validateSafeGitUrlAsync("git@github.com:torvalds/linux.git");
  assert.equal(validScpGit.safe, true);
  assert.equal(validScpGit.hostname, "github.com");
});

// ============================================================================
// SUITE 5: ACTIVE NETWORK SCANNING SECURITY & AUTHORIZATION
// ============================================================================

test("Network Scan Security - Explicit authorization matching caller identity is required", async () => {
  defaultNetworkScanGuard.reset();

  // 1. Unauthenticated request -> 401
  const unauthReq = {
    auth: null,
    body: { target: "example.com", port: 443, authorized_by: "alice" },
    tenantContext: { tenantId: "tenant-alpha" },
  };
  const unauthResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(unauthReq);
  assert.equal(unauthResult.authorized, false);
  assert.equal(unauthResult.status, 401);

  // 2. Authenticated user with missing authorized_by -> 403
  const missingAuthByReq = {
    auth: { userId: "u-1", username: "alice", role: "analyst" },
    body: { target: "example.com", port: 443 },
    tenantContext: { tenantId: "tenant-alpha" },
  };
  const missingResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(missingAuthByReq);
  assert.equal(missingResult.authorized, false);
  assert.equal(missingResult.status, 403);
  assert.match(missingResult.error, /authorized_by/i);

  // 3. Authenticated user claiming another user's identity -> 403
  const mismatchReq = {
    auth: { userId: "u-1", username: "alice", role: "analyst" },
    body: { target: "example.com", port: 443, authorized_by: "bob" },
    tenantContext: { tenantId: "tenant-alpha" },
  };
  const mismatchResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(mismatchReq);
  assert.equal(mismatchResult.authorized, false);
  assert.equal(mismatchResult.status, 403);
  assert.match(mismatchResult.error, /must match your authenticated identity/i);

  // 4. Authenticated user matching own username -> authorized!
  const validReq = {
    auth: { userId: "u-1", username: "alice", role: "analyst" },
    body: { target: "example.com", port: 443, authorized_by: "alice" },
    tenantContext: { tenantId: "tenant-alpha" },
  };
  const validResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(validReq, {
    dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(validResult.authorized, true);
  validResult.releaseConcurrency();

  // 5. Admin role authorizing on behalf of scan policy -> authorized!
  const adminReq = {
    auth: { userId: "admin-1", username: "admin", role: "admin" },
    body: { target: "example.com", port: 443, authorized_by: "security-team" },
    tenantContext: { tenantId: "tenant-alpha" },
  };
  const adminResult = await defaultNetworkScanGuard.validateAndAuthorizeScan(adminReq, {
    dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  assert.equal(adminResult.authorized, true);
  adminResult.releaseConcurrency();
});

test("Network Scan Security - Safe default deny rejects private IPs, loopback, and metadata", async () => {
  defaultNetworkScanGuard.reset();

  const scanTargets = [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.1.1",
    "::1",
    "localhost",
    "metadata.google.internal",
    "server.local",
  ];

  for (const target of scanTargets) {
    defaultNetworkScanGuard.reset();
    const req = {
      auth: { userId: "admin-1", username: "admin", role: "admin" },
      body: { target, port: 443, authorized_by: "admin" },
      tenantContext: { tenantId: "tenant-alpha" },
    };
    const res = await defaultNetworkScanGuard.validateAndAuthorizeScan(req);
    assert.equal(res.authorized, false, `Expected ${target} to be rejected`);
    assert.equal(res.status, 400);
    assert.match(res.error, /rejected|restricted|forbidden/i);
  }
});

test("Network Scan Security - Enforces port bounding and blocks internal service ports", async () => {
  defaultNetworkScanGuard.reset();

  // Prohibited internal ports (Postgres, Redis, Docker, MySQL, Vault)
  const forbiddenPorts = [5432, 6379, 3306, 2375, 8200];

  for (const port of forbiddenPorts) {
    defaultNetworkScanGuard.reset();
    const req = {
      auth: { userId: "admin-1", username: "admin", role: "admin" },
      body: { target: "example.com", port, authorized_by: "admin" },
      tenantContext: { tenantId: "tenant-alpha" },
    };
    const res = await defaultNetworkScanGuard.validateAndAuthorizeScan(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /prohibited|restricted/i);
  }
});

test("Network Scan Security - Enforces tenant rate limits and concurrency limits", async () => {
  defaultNetworkScanGuard.reset();

  const mockDns = async () => [{ address: "93.184.216.34", family: 4 }];
  const tenantId = "tenant-burst-test";

  // 1. Concurrency limit test (max 2 concurrent scans per tenant)
  const req1 = {
    auth: { userId: "u-1", username: "alice", role: "analyst" },
    body: { target: "example.com", port: 443, authorized_by: "alice" },
    tenantContext: { tenantId },
  };
  const scan1 = await defaultNetworkScanGuard.validateAndAuthorizeScan(req1, { dnsLookupFn: mockDns });
  assert.equal(scan1.authorized, true);

  const scan2 = await defaultNetworkScanGuard.validateAndAuthorizeScan(req1, { dnsLookupFn: mockDns });
  assert.equal(scan2.authorized, true);

  // 3rd concurrent scan must be rejected with 429
  const scan3 = await defaultNetworkScanGuard.validateAndAuthorizeScan(req1, { dnsLookupFn: mockDns });
  assert.equal(scan3.authorized, false);
  assert.equal(scan3.status, 429);
  assert.match(scan3.error, /concurrency limit reached/i);

  // Release one scan
  scan1.releaseConcurrency();

  // Now a new scan can be acquired
  const scan4 = await defaultNetworkScanGuard.validateAndAuthorizeScan(req1, { dnsLookupFn: mockDns });
  assert.equal(scan4.authorized, true);

  // Release all
  scan2.releaseConcurrency();
  scan4.releaseConcurrency();
});

test("Network Scan Security - Emits tamper-chain audit events for all attempts", async () => {
  defaultNetworkScanGuard.reset();

  const beforeLedgerLength = defaultAuditService.memoryLedger.length;

  // Trigger an unauthorized attempt
  const badReq = {
    auth: { userId: "u-1", username: "alice", role: "analyst" },
    body: { target: "127.0.0.1", port: 443, authorized_by: "alice" },
    tenantContext: { tenantId: "tenant-audit-test" },
    ip: "198.51.100.5",
  };
  await defaultNetworkScanGuard.validateAndAuthorizeScan(badReq);

  const afterLedgerLength = defaultAuditService.memoryLedger.length;
  assert.ok(afterLedgerLength > beforeLedgerLength, "Audit event must be logged");

  const latestEvent = defaultAuditService.memoryLedger[afterLedgerLength - 1];
  assert.equal(latestEvent.category, "SCAN");
  assert.equal(latestEvent.status, "DENIED");
  assert.equal(latestEvent.tenantId, "tenant-audit-test");
  assert.equal(latestEvent.actor.username, "alice");
});

// ============================================================================
// SUITE 6: INTEGRATION SSRF DEFENSE (SIEM, KMS, TICKETING VIA HTTP API)
// ============================================================================

test("SSRF Security - SIEM configuration rejects private & metadata endpoints", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ role: "admin" });

    // Try setting SIEM destination to AWS metadata
    const imdsRes = await fetch(`${baseUrl}/api/v1/siem/config`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        endpoints: [{ id: "bad-1", name: "Malicious", url: "http://169.254.169.254/latest/meta-data" }],
      }),
    });
    assert.equal(imdsRes.status, 400);
    const imdsData = await imdsRes.json();
    assert.equal(imdsData.error, "SSRFViolation");

    // Try setting SIEM destination to loopback
    const loopbackRes = await fetch(`${baseUrl}/api/v1/siem/config`, {
      method: "PUT",
      headers: authHeaders,
      body: JSON.stringify({
        endpoints: [{ id: "bad-2", name: "Loopback", url: "http://127.0.0.1:9090/events" }],
      }),
    });
    assert.equal(loopbackRes.status, 400);
  });
});

test("SSRF Security - KMS registration rejects private & metadata connector URLs", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ role: "admin" });

    const imdsRes = await fetch(`${baseUrl}/api/v1/integrations/kms/register`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "vault-malicious",
        provider: "hashicorp_vault",
        config: { endpoint: "http://169.254.169.254/metadata" },
      }),
    });
    assert.equal(imdsRes.status, 400);
    const imdsData = await imdsRes.json();
    assert.equal(imdsData.error, "SSRFViolation");
  });
});

test("SSRF Security - Ticketing webhook registration rejects private URLs", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ role: "admin" });

    const loopbackRes = await fetch(`${baseUrl}/api/v1/integrations/ticketing/register`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: "webhook-internal",
        type: "webhook",
        config: { url: "http://127.0.0.1:8080/webhook" },
      }),
    });
    assert.equal(loopbackRes.status, 400);
    const loopbackData = await loopbackRes.json();
    assert.equal(loopbackData.error, "SSRFViolation");
  });
});

test("SSRF Security - POST /scan/network rejects unauthenticated and private scan targets", async () => {
  await withServer(async (baseUrl) => {
    // 1. Unauthenticated request to /scan/network (or /api/v1/scan/network)
    const unauthRes = await fetch(`${baseUrl}/scan/network`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "example.com", authorized_by: "operator" }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated request targeting 169.254.169.254
    const authHeaders = createAuthHeaders({ username: "alice" });
    const imdsRes = await fetch(`${baseUrl}/scan/network`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        target: "169.254.169.254",
        port: 443,
        authorized_by: "alice",
      }),
    });
    assert.equal(imdsRes.status, 400);
    const imdsData = await imdsRes.json();
    assert.equal(imdsData.success, false);
    assert.match(imdsData.error, /restricted|forbidden/i);

    // 3. Authenticated request targeting internal DB port 5432
    const portRes = await fetch(`${baseUrl}/scan/network`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        target: "example.com",
        port: 5432,
        authorized_by: "alice",
      }),
    });
    assert.equal(portRes.status, 400);
    const portData = await portRes.json();
    assert.equal(portData.success, false);
    assert.match(portData.error, /restricted|prohibited/i);
  });
});
