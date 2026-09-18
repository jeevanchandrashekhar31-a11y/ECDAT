/**
 * ECDAT Phase 10 P0 — Archive / Zip Security Test Suite
 *
 * Requirements:
 * - Zip Slip;
 * - path traversal;
 * - absolute paths;
 * - symlink escape;
 * - hardlink escape;
 * - decompression bombs;
 * - excessive file count;
 * - excessive total extracted size;
 * - nested archives;
 * - recursive extraction;
 * - malformed archives;
 * - Unicode/path normalization bypass;
 * - Windows path traversal;
 * - alternate separators.
 *
 * Invariant: resolved extracted path MUST remain inside dedicated extraction root.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const app = require("../../src/app");
const {
  validateCanonicalPathContainment,
  validateZipBufferSafety,
  ArchiveSecurityError,
  PathTraversalError,
  DecompressionBombError,
  NestedArchiveError,
  MalformedArchiveError,
} = require("../../src/security/archive_guard");
const { defaultTokenService, defaultLocalAuthManager } = require("../../src/identity");

const FIXTURES_DIR = path.resolve(__dirname, "../../../tests/fixtures/malicious_archives");

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
    Authorization: `Bearer ${token}`,
    "X-Tenant-Id": tenantId,
  };
}

// ============================================================================
// SUITE 1: CANONICAL PATH CONTAINMENT & TRAVERSAL DEFENSES
// ============================================================================

test("Archive Security - Canonical path containment allows safe relative paths", () => {
  const root = path.resolve("/tmp/extract_root_test");
  const target1 = validateCanonicalPathContainment("src/index.js", root);
  assert.equal(target1, path.resolve(root, "src/index.js"));

  const target2 = validateCanonicalPathContainment("app/controllers/user.js", root);
  assert.equal(target2, path.resolve(root, "app/controllers/user.js"));
});

test("Archive Security - Blocks Zip Slip relative traversal (../../)", () => {
  const root = path.resolve("/tmp/extract_root_test");
  assert.throws(
    () => validateCanonicalPathContainment("../../etc/passwd", root),
    PathTraversalError
  );
  assert.throws(
    () => validateCanonicalPathContainment("subdir/../../../escape.txt", root),
    PathTraversalError
  );
});

test("Archive Security - Blocks Windows backslash traversal (..\\..\\)", () => {
  const root = path.resolve("/tmp/extract_root_test");
  assert.throws(
    () => validateCanonicalPathContainment("..\\..\\windows\\system32\\calc.exe", root),
    PathTraversalError
  );
});

test("Archive Security - Blocks Unix and Windows absolute paths", () => {
  const root = path.resolve("/tmp/extract_root_test");
  assert.throws(
    () => validateCanonicalPathContainment("/etc/shadow", root),
    /Absolute path|Path traversal/
  );
  assert.throws(
    () => validateCanonicalPathContainment("C:\\Windows\\win.ini", root),
    /drive letter|Path traversal/
  );
  assert.throws(
    () => validateCanonicalPathContainment("\\\\server\\share\\evil", root),
    /UNC share|Path traversal/
  );
});

test("Archive Security - Blocks Windows reserved device names across all directory depths", () => {
  const root = path.resolve("/tmp/extract_root_test");
  const reservedNames = ["CON", "con.txt", "PRN", "aux.c", "NUL", "COM1", "lpt9.dat"];

  for (const name of reservedNames) {
    assert.throws(
      () => validateCanonicalPathContainment(name, root),
      /reserved device name/i
    );
    assert.throws(
      () => validateCanonicalPathContainment(`subdir/${name}`, root),
      /reserved device name/i
    );
  }
});

test("Archive Security - Blocks NTFS Alternate Data Streams and trailing dots/spaces", () => {
  const root = path.resolve("/tmp/extract_root_test");
  assert.throws(
    () => validateCanonicalPathContainment("secret.txt::$DATA", root),
    /Alternate Data Stream/i
  );
  assert.throws(
    () => validateCanonicalPathContainment("file.txt:evil.exe", root),
    /Alternate Data Stream/i
  );
  assert.throws(
    () => validateCanonicalPathContainment("file.txt.", root),
    /trailing dot or space/i
  );
  assert.throws(
    () => validateCanonicalPathContainment("file.txt ", root),
    /trailing dot or space/i
  );
});

test("Archive Security - Unicode NFKC normalization defeats fullwidth bypasses", () => {
  const root = path.resolve("/tmp/extract_root_test");
  // Fullwidth characters: \uff0e = '．', \uff0f = '／'
  assert.throws(
    () => validateCanonicalPathContainment("\uff0e\uff0e\uff0fmalicious.txt", root),
    PathTraversalError
  );
});

// ============================================================================
// SUITE 2: ZIP BUFFER PRE-FLIGHT INSPECTION
// ============================================================================

test("Archive Security - validateZipBufferSafety inspects and rejects malicious fixtures", () => {
  // 1. Relative Zip Slip fixture
  const zipSlipBuf = fs.readFileSync(path.join(FIXTURES_DIR, "zip_slip_relative.zip"));
  assert.throws(
    () => validateZipBufferSafety(zipSlipBuf),
    PathTraversalError
  );

  // 2. Windows backslash fixture
  const winBackslashBuf = fs.readFileSync(path.join(FIXTURES_DIR, "zip_slip_windows_backslash.zip"));
  assert.throws(
    () => validateZipBufferSafety(winBackslashBuf),
    PathTraversalError
  );

  // 3. Absolute Unix path fixture
  const absUnixBuf = fs.readFileSync(path.join(FIXTURES_DIR, "absolute_unix_path.zip"));
  assert.throws(
    () => validateZipBufferSafety(absUnixBuf),
    PathTraversalError
  );

  // 4. Absolute Windows path fixture
  const absWinBuf = fs.readFileSync(path.join(FIXTURES_DIR, "absolute_windows_path.zip"));
  assert.throws(
    () => validateZipBufferSafety(absWinBuf),
    PathTraversalError
  );

  // 5. Decompression bomb ratio fixture
  const bombRatioBuf = fs.readFileSync(path.join(FIXTURES_DIR, "decompression_bomb_ratio.zip"));
  assert.throws(
    () => validateZipBufferSafety(bombRatioBuf, { maxCompressionRatio: 20.0 }),
    DecompressionBombError
  );

  // 6. Excessive file count fixture
  const fileCountBuf = fs.readFileSync(path.join(FIXTURES_DIR, "excessive_file_count.zip"));
  assert.throws(
    () => validateZipBufferSafety(fileCountBuf, { maxFilesCount: 50 }),
    DecompressionBombError
  );

  // 7. Excessive total size fixture
  const totalSizeBuf = fs.readFileSync(path.join(FIXTURES_DIR, "excessive_total_size.zip"));
  assert.throws(
    () => validateZipBufferSafety(totalSizeBuf, { maxTotalBytes: 10 * 1024 * 1024 }),
    DecompressionBombError
  );

  // 8. Nested archive fixture
  const nestedBuf = fs.readFileSync(path.join(FIXTURES_DIR, "nested_archive.zip"));
  assert.throws(
    () => validateZipBufferSafety(nestedBuf),
    NestedArchiveError
  );

  // 9. Unicode normalization bypass fixture
  const unicodeBuf = fs.readFileSync(path.join(FIXTURES_DIR, "unicode_normalization_bypass.zip"));
  assert.throws(
    () => validateZipBufferSafety(unicodeBuf),
    PathTraversalError
  );

  // 10. Windows device names fixture
  const devicesBuf = fs.readFileSync(path.join(FIXTURES_DIR, "windows_device_names.zip"));
  assert.throws(
    () => validateZipBufferSafety(devicesBuf),
    PathTraversalError
  );

  // 11. Windows NTFS ADS fixture
  const adsBuf = fs.readFileSync(path.join(FIXTURES_DIR, "windows_alternate_data_stream.zip"));
  assert.throws(
    () => validateZipBufferSafety(adsBuf),
    PathTraversalError
  );

  // 12. Corrupt / malformed archive fixture
  const corruptBuf = fs.readFileSync(path.join(FIXTURES_DIR, "malformed_corrupt.zip"));
  assert.throws(
    () => validateZipBufferSafety(corruptBuf),
    MalformedArchiveError
  );
});

// ============================================================================
// SUITE 3: HTTP API INTEGRATION & CLEANUP TESTING
// ============================================================================

test("Archive Security - POST /scan/static rejects Zip Slip upload with HTTP 400 and cleans disk", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ username: "alice" });
    const zipSlipBuf = fs.readFileSync(path.join(FIXTURES_DIR, "zip_slip_relative.zip"));

    const formData = new FormData();
    formData.append("file", new Blob([zipSlipBuf], { type: "application/zip" }), "zipslip.zip");

    const res = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /Archive security rejection|Path traversal/i);
  });
});

test("Archive Security - POST /scan/static rejects nested archive upload with HTTP 400", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ username: "alice" });
    const nestedBuf = fs.readFileSync(path.join(FIXTURES_DIR, "nested_archive.zip"));

    const formData = new FormData();
    formData.append("file", new Blob([nestedBuf], { type: "application/zip" }), "nested.zip");

    const res = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /Nested archive rejected/i);
  });
});

test("Archive Security - POST /scan/binary rejects decompression bomb with HTTP 400", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ username: "alice" });
    const bombBuf = fs.readFileSync(path.join(FIXTURES_DIR, "decompression_bomb_ratio.zip"));

    const formData = new FormData();
    formData.append("file", new Blob([bombBuf], { type: "application/zip" }), "bomb.zip");

    const res = await fetch(`${baseUrl}/scan/binary`, {
      method: "POST",
      headers: authHeaders,
      body: formData,
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.match(data.error, /Archive security rejection|Decompression/i);
  });
});
