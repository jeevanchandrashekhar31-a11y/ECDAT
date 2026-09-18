const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const app = require("../../src/app");
const {
  validateUrl,
  validateHostname,
  validateIpAddress,
  validateLength,
  validateEnum,
  validateNumericBounds,
  validatePagination,
  validateFile,
  validateCbomContent,
  validateSchemaStrict,
  SCHEMAS,
  ALLOWED_ROLES,
  ALLOWED_SEVERITIES,
  ALLOWED_ASSET_TYPES,
  ALLOWED_KMS_PROVIDERS,
  ALLOWED_TICKETING_TYPES,
  ALLOWED_EXPORT_FORMATS,
  DANGEROUS_MIMES,
} = require("../../src/security/input_validation");

function withServer(appInstance, testFn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(appInstance);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await testFn(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("Phase 19.1 — Strict Schemas & Unknown Field Rejection", () => {
  const validUser = {
    username: "security_auditor",
    password: "SuperSecretPassword123!",
    email: "auditor@enterprise.internal",
  };
  const middleware = validateSchemaStrict(SCHEMAS.USER_REGISTRATION);
  const req = { body: validUser };
  let nextCalled = false;
  const res = {
    status: () => res,
    json: () => {},
  };

  middleware(req, res, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true, "Valid payload must proceed to next()");

  // Rejection of unknown properties
  const payloadWithUnknownField = {
    username: "attacker",
    password: "Password12345!",
    email: "attacker@domain.com",
    isAdmin: true, // Unknown property
    role: "platform_admin", // Unknown property
  };

  let statusCode = 0;
  let errorBody = null;
  const resErr = {
    status: (code) => {
      statusCode = code;
      return resErr;
    },
    json: (data) => {
      errorBody = data;
    },
  };

  middleware({ body: payloadWithUnknownField }, resErr, () => {});
  assert.strictEqual(statusCode, 400, "Must return HTTP 400 when unknown property is present");
  assert.strictEqual(errorBody.code, "VALIDATION_ERROR");
  assert.ok(
    errorBody.errors.some((e) => e.keyword === "additionalProperties"),
    "Must flag additionalProperties violation"
  );
});

test("Phase 19.2 — Type Validation (Strict Types, No Type Juggling)", () => {
  const middleware = validateSchemaStrict(SCHEMAS.USER_LOGIN);
  const req = { body: { username: 12345, password: ["array_password"] } };
  let statusCode = 0;
  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: () => {},
  };

  middleware(req, res, () => {});
  assert.strictEqual(statusCode, 400, "Must reject number/array for string inputs");
});

test("Phase 19.3 — Length Limits", () => {
  const resMin = validateLength("ab", { min: 3, max: 64, fieldName: "username" });
  assert.strictEqual(resMin.valid, false);
  assert.ok(resMin.error.includes("less than minimum"));

  const longStr = "a".repeat(256);
  const resMax = validateLength(longStr, { min: 1, max: 64, fieldName: "identifier" });
  assert.strictEqual(resMax.valid, false);
  assert.ok(resMax.error.includes("exceeds maximum"));

  const resOk = validateLength("valid_string", { min: 3, max: 64, fieldName: "test" });
  assert.strictEqual(resOk.valid, true);
});

test("Phase 19.4 — Enum Validation", () => {
  for (const role of ALLOWED_ROLES) {
    assert.strictEqual(validateEnum(role, ALLOWED_ROLES).valid, true);
  }
  for (const sev of ALLOWED_SEVERITIES) {
    assert.strictEqual(validateEnum(sev, ALLOWED_SEVERITIES).valid, true);
  }

  const res = validateEnum("SUPER_ROOT_ADMIN", ALLOWED_ROLES, "role");
  assert.strictEqual(res.valid, false);
  assert.ok(res.error.includes("Invalid value"));
});

test("Phase 19.5 — URL Validation & SSRF Defense", () => {
  const resOk = validateUrl("https://api.github.com/repos/org/repo");
  assert.strictEqual(resOk.valid, true);
  assert.strictEqual(resOk.parsed.hostname, "api.github.com");

  // Reject dangerous pseudo-protocols
  assert.strictEqual(validateUrl("javascript:alert(1)").valid, false);
  assert.strictEqual(validateUrl("data:text/html;base64,PHNjcmlwdD4=").valid, false);
  assert.strictEqual(validateUrl("file:///etc/passwd").valid, false);

  // Reject internal cloud metadata and loopback URLs
  assert.strictEqual(validateUrl("http://169.254.169.254/latest/meta-data/").valid, false);
  assert.strictEqual(validateUrl("http://localhost:8080/admin").valid, false);
  assert.strictEqual(validateUrl("http://127.0.0.1:2375/version").valid, false);

  // Length limits
  const longUrl = "https://example.com/" + "a".repeat(2040);
  assert.strictEqual(validateUrl(longUrl).valid, false);
});

test("Phase 19.6 — Hostname Validation", () => {
  assert.strictEqual(validateHostname("api.vault.company.com").valid, true);
  assert.strictEqual(validateHostname("kms-us-east-1.amazonaws.com").valid, true);

  // Reject control characters and illegal whitespace
  assert.strictEqual(validateHostname("api.vault\0.com").valid, false);
  assert.strictEqual(validateHostname("api. vault.com").valid, false);

  // Reject forbidden hostnames
  assert.strictEqual(validateHostname("localhost").valid, false);
  assert.strictEqual(validateHostname("metadata.google.internal").valid, false);
});

test("Phase 19.7 — IP Validation", () => {
  const ipv4 = validateIpAddress("8.8.8.8");
  assert.strictEqual(ipv4.valid, true);
  assert.strictEqual(ipv4.version, "IPv4");

  const ipv6 = validateIpAddress("2001:4860:4860::8888");
  assert.strictEqual(ipv6.valid, true);
  assert.strictEqual(ipv6.version, "IPv6");

  // Invalid syntax
  assert.strictEqual(validateIpAddress("999.999.999.999").valid, false);
  assert.strictEqual(validateIpAddress("not-an-ip").valid, false);

  // Private range blocking
  assert.strictEqual(validateIpAddress("127.0.0.1").valid, false);
  assert.strictEqual(validateIpAddress("10.0.0.1").valid, false);
  assert.strictEqual(validateIpAddress("192.168.1.1").valid, false);
  assert.strictEqual(validateIpAddress("172.16.0.1").valid, false);
  assert.strictEqual(validateIpAddress("169.254.169.254").valid, false);
});

test("Phase 19.8 — File Validation & Path Traversal Rejection", () => {
  assert.strictEqual(
    validateFile({ originalname: "../../etc/passwd.json", buffer: Buffer.from("{}") }).valid,
    false
  );
  assert.strictEqual(
    validateFile({ originalname: "cbom\0.json", buffer: Buffer.from("{}") }).valid,
    false
  );

  const resExt = validateFile({
    originalname: "exploit.exe",
    buffer: Buffer.from("MZ"),
  });
  assert.strictEqual(resExt.valid, false);
  assert.ok(resExt.error.includes("not allowed"));

  const resOk = validateFile({
    originalname: "cyclonedx_cbom.cdx.json",
    mimetype: "application/json",
    buffer: Buffer.from(JSON.stringify({ bomFormat: "CycloneDX" })),
  });
  assert.strictEqual(resOk.valid, true);
});

test("Phase 19.9 — MIME Validation", () => {
  for (const mime of DANGEROUS_MIMES) {
    if (mime === "application/octet-stream") continue;
    const res = validateFile({
      originalname: "report.json",
      mimetype: mime,
      buffer: Buffer.from("{}"),
    });
    assert.strictEqual(res.valid, false, `Must reject dangerous MIME '${mime}'`);
  }
});

test("Phase 19.10 — Content Validation (JSON Structure & Private Key Detection)", () => {
  const resBadJson = validateCbomContent(Buffer.from("invalid json {{{"));
  assert.strictEqual(resBadJson.valid, false);
  assert.ok(resBadJson.error.includes("JSON parse error") || resBadJson.error.includes("JSON structure"));

  const maliciousCbom = {
    bomFormat: "CycloneDX",
    components: [
      {
        name: "leaked-key",
        cryptoProperties: {
          privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...\n-----END RSA PRIVATE KEY-----",
        },
      },
    ],
  };
  const resPrivKey = validateCbomContent(Buffer.from(JSON.stringify(maliciousCbom)));
  assert.strictEqual(resPrivKey.valid, false);
  assert.ok(resPrivKey.error.includes("private key material"));

  const clean = { bomFormat: "CycloneDX", specVersion: "1.6", components: [] };
  const resOk = validateCbomContent(Buffer.from(JSON.stringify(clean)));
  assert.strictEqual(resOk.valid, true);
});

test("Phase 19.11 — Numeric Bounds", () => {
  assert.strictEqual(validateNumericBounds("not-a-number").valid, false);
  assert.strictEqual(validateNumericBounds(Infinity).valid, false);
  assert.strictEqual(validateNumericBounds(NaN).valid, false);

  assert.strictEqual(validateNumericBounds(4.5, { integerOnly: true }).valid, false);
  assert.strictEqual(validateNumericBounds(4, { integerOnly: true }).valid, true);

  assert.strictEqual(validateNumericBounds(0, { min: 1, max: 100 }).valid, false);
  assert.strictEqual(validateNumericBounds(101, { min: 1, max: 100 }).valid, false);
  assert.strictEqual(validateNumericBounds(50, { min: 1, max: 100 }).valid, true);
});

test("Phase 19.12 — Pagination Bounds", () => {
  assert.strictEqual(validatePagination({ page: 0 }).valid, false);
  assert.strictEqual(validatePagination({ page: -5 }).valid, false);
  assert.strictEqual(validatePagination({ pageSize: 500 }).valid, false);

  const res = validatePagination({});
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.pagination.page, 1);
  assert.strictEqual(res.pagination.pageSize, 25);
  assert.strictEqual(res.pagination.offset, 0);

  const p2 = validatePagination({ page: 2, pageSize: 20 });
  assert.strictEqual(p2.valid, true);
  assert.strictEqual(p2.pagination.offset, 20);
});

test("Phase 19.13 — Live Routes Enforce Server-Side Validation (Never Trust Frontend)", async () => {
  await withServer(app, async (baseUrl) => {
    // 1. Assets pagination out of bounds (negative page)
    const resAssets = await fetch(`${baseUrl}/api/v1/assets?page=-1`);
    assert.strictEqual(resAssets.status, 400);
    const bodyAssets = await resAssets.json();
    assert.strictEqual(bodyAssets.code, "PAGINATION_OUT_OF_BOUNDS");

    // 2. Audit events pagination out of bounds (pageSize=999999)
    const config = require("../../src/config");
    const resAudit = await fetch(`${baseUrl}/api/v1/audit/events?pageSize=999999`, {
      headers: {
        "x-api-key": config.ECDAT_API_KEY,
        "x-user-role": "admin",
      },
    });
    assert.strictEqual(resAudit.status, 400);
    const bodyAudit = await resAudit.json();
    assert.strictEqual(bodyAudit.code, "PAGINATION_OUT_OF_BOUNDS");

    // 3. Secrets rotate rejecting unknown fields (mass-assignment protection)
    const { defaultTokenService } = require("../../src/identity/token_service");
    const { ROLES } = require("../../src/middleware/rbac");
    const platAdminTokens = defaultTokenService.issueTokenPair({
      userId: "usr_platadmin_test",
      username: "platadmin_test",
      roles: [ROLES.PLATFORM_ADMIN],
      tenantId: "system",
    });

    const resSecrets = await fetch(`${baseUrl}/api/v1/auth/secrets/rotate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platAdminTokens.accessToken}`,
      },
      body: JSON.stringify({
        keyType: "jwt_signing",
        newSecret: "synthetic-valid-secret-key-16chars",
        arbitraryInjectedField: true, // Unknown field
      }),
    });
    assert.strictEqual(resSecrets.status, 400);
    const bodySecrets = await resSecrets.json();
    assert.strictEqual(bodySecrets.error, "ValidationError");
    assert.ok(bodySecrets.errors.some((e) => e.keyword === "additionalProperties"));

    // 4. KMS register rejecting invalid enum provider
    const resKms = await fetch(`${baseUrl}/api/v1/integrations/kms/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ECDAT_API_KEY,
        "x-user-role": "admin",
      },
      body: JSON.stringify({
        name: "malicious-connector",
        provider: "untrusted_cloud_hsm",
      }),
    });
    assert.strictEqual(resKms.status, 400);
    const bodyKms = await resKms.json();
    assert.ok(bodyKms.error.includes("Unsupported provider"));
  });
});
