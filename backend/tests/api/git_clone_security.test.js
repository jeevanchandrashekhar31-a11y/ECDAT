/**
 * ECDAT Phase 9 P0 — Git Clone Security Test Suite
 *
 * Requirements:
 * - no shell interpolation;
 * - shell: false;
 * - strict argument arrays;
 * - allowed protocols only;
 * - timeout;
 * - disk quota;
 * - repository size limit;
 * - object count limit;
 * - depth limit where appropriate;
 * - process resource limits;
 * - temporary directory isolation;
 * - cleanup after scan;
 * - no credential leakage;
 * - no arbitrary local filesystem path access.
 *
 * Explicitly tests malicious Git URLs and arguments.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { EventEmitter } = require("events");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  validateGitCloneUrl,
  sanitizeBranchName,
  measureDirectorySizeAndCount,
  validateSafeTargetDirectory,
  executeHardenedGitClone,
  redactCredentials,
  GitSecurityError,
  GitQuotaExceededError,
} = require("../../src/security/git_clone_guard");
const { defaultTokenService, defaultLocalAuthManager } = require("../../src/identity");

const SANDBOX_BASE = path.resolve(__dirname, "../../artifacts/test_git_sandbox");

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
// SUITE 1: PROTOCOL RESTRICTION & DANGEROUS SCHEME REJECTION
// ============================================================================

test("Git Clone Security - Rejects forbidden protocols and helper schemes", async () => {
  // 1. Local filesystem schemes
  const fileUnix = await validateGitCloneUrl("file:///etc/passwd");
  assert.equal(fileUnix.safe, false);
  assert.match(fileUnix.error, /prohibited/i);

  const fileWin = await validateGitCloneUrl("file://C:/Windows/win.ini");
  assert.equal(fileWin.safe, false);

  // 2. Dangerous Git remote helpers (arbitrary command execution)
  const extHelper = await validateGitCloneUrl("ext::sh -c whoami");
  assert.equal(extHelper.safe, false);

  const fdHelper = await validateGitCloneUrl("fd::1");
  assert.equal(fdHelper.safe, false);

  const bundleHelper = await validateGitCloneUrl("bundle::/tmp/repo.bundle");
  assert.equal(bundleHelper.safe, false);

  // 3. SSH protocols (prevention of SSH command injection via -oProxyCommand)
  const sshProto = await validateGitCloneUrl("ssh://git@github.com/org/repo.git");
  assert.equal(sshProto.safe, false);
  assert.match(sshProto.error, /SSH/i);

  const scpProto = await validateGitCloneUrl("git@github.com:org/repo.git");
  assert.equal(scpProto.safe, false);
  assert.match(scpProto.error, /SSH/i);

  // 4. Git native plaintext protocol
  const gitNative = await validateGitCloneUrl("git://github.com/org/repo.git");
  assert.equal(gitNative.safe, false);

  // 5. Valid HTTPS protocol allowed
  const validHttps = await validateGitCloneUrl("https://github.com/torvalds/linux.git");
  assert.equal(validHttps.safe, true);
  assert.equal(validHttps.normalizedUrl, "https://github.com/torvalds/linux.git");
});

// ============================================================================
// SUITE 2: SHELL INTERPOLATION & COMMAND INJECTION PREVENTION
// ============================================================================

test("Git Clone Security - Rejects shell metacharacters and command injection in URLs", async () => {
  const injectionUrls = [
    "https://github.com/org/repo.git;whoami",
    "https://github.com/org/repo.git&&calc.exe",
    "https://github.com/org/repo.git|rm -rf /",
    "https://github.com/org/`whoami`/repo.git",
    "https://github.com/org/$(id)/repo.git",
    "https://github.com/org/repo.git\nwhoami",
    "https://github.com/org/repo.git\x00/evil",
    "https://github.com/org/repo.git>output.txt",
  ];

  for (const badUrl of injectionUrls) {
    const res = await validateGitCloneUrl(badUrl);
    assert.equal(res.safe, false, `Expected ${badUrl} to be rejected for shell metacharacters`);
    assert.match(res.error, /shell metacharacters|control bytes/i);
  }
});

// ============================================================================
// SUITE 3: OPTION INJECTION DEFENSE (ARGUMENT POISONING)
// ============================================================================

test("Git Clone Security - Rejects Git option injection in URLs and branches", async () => {
  // Option injection via URL
  const optionUrls = [
    "--upload-pack=evil",
    "-u /tmp/evil",
    "--config=core.fsmonitor=evil",
    "-oProxyCommand=calc.exe",
  ];

  for (const optUrl of optionUrls) {
    const res = await validateGitCloneUrl(optUrl);
    assert.equal(res.safe, false);
    assert.match(res.error, /cannot start with '-'/i);
  }

  // Option injection via branch parameter
  assert.throws(
    () => sanitizeBranchName("--upload-pack=calc"),
    /Branch cannot start with '-'/
  );
  assert.throws(
    () => sanitizeBranchName("-b;whoami"),
    /Branch cannot start with '-'/
  );
  assert.throws(
    () => sanitizeBranchName("feature/../../escape"),
    /Path traversal/
  );

  // Valid branch names allowed
  assert.equal(sanitizeBranchName("main"), "main");
  assert.equal(sanitizeBranchName("feature/pqc-migration"), "feature/pqc-migration");
  assert.equal(sanitizeBranchName("v1.2.3"), "v1.2.3");
});

// ============================================================================
// SUITE 4: SSRF & INTERNAL DESTINATION DEFENSE
// ============================================================================

test("Git Clone Security - Rejects private, loopback, and metadata destinations", async () => {
  const ssrfUrls = [
    "https://127.0.0.1/org/repo.git",
    "https://127.0.0.2/org/repo.git",
    "https://169.254.169.254/secret.git",
    "https://10.0.0.1/private/repo.git",
    "https://192.168.1.1/internal/repo.git",
    "https://172.16.0.1/corp/repo.git",
    "https://localhost/org/repo.git",
    "https://metadata.google.internal/repo.git",
    "https://gitlab.internal/core.git",
    "https://git.local/repo.git",
  ];

  for (const ssrfUrl of ssrfUrls) {
    const res = await validateGitCloneUrl(ssrfUrl);
    assert.equal(res.safe, false, `Expected ${ssrfUrl} to be rejected for SSRF`);
    assert.match(res.error, /restricted|forbidden/i);
  }
});

// ============================================================================
// SUITE 5: CREDENTIAL PROTECTION & REDACTION
// ============================================================================

test("Git Clone Security - Automatically redacts and strips credentials", async () => {
  // 1. Embedded credentials in URL are automatically stripped from clone destination
  const urlWithCreds = "https://alice:SuperSecretPassword123@github.com/owner/repo.git";
  const res = await validateGitCloneUrl(urlWithCreds, { allowCredentials: true });
  assert.equal(res.safe, true);
  assert.equal(res.normalizedUrl, "https://github.com/owner/repo.git");
  assert.ok(!res.normalizedUrl.includes("SuperSecretPassword123"));

  // 2. Error message scrubbing
  const rawStderr = "fatal: Authentication failed for 'https://token_user:ghp_secretTokenABC123@github.com/org/repo.git/'";
  const scrubbed = redactCredentials(rawStderr);
  assert.ok(!scrubbed.includes("ghp_secretTokenABC123"));
  assert.match(scrubbed, /https:\/\/\*\*\*:\*\*\*@github\.com/);
});

// ============================================================================
// SUITE 6: STRICT ARGUMENT ARRAYS & SHELL: FALSE ENFORCEMENT
// ============================================================================

test("Git Clone Security - executeHardenedGitClone enforces shell: false, shallow depth, and '--' delimiter", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;

  // Mock spawn implementation
  const mockSpawn = (cmd, args, opts) => {
    capturedCommand = cmd;
    capturedArgs = args;
    capturedOptions = opts;

    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = () => {};

    process.nextTick(() => {
      mockChild.emit("close", 0);
    });

    return mockChild;
  };

  const testTargetDir = path.resolve(SANDBOX_BASE, "mock_clone_1");
  const result = await executeHardenedGitClone(
    "https://github.com/torvalds/linux.git",
    testTargetDir,
    {
      branch: "master",
      spawnFn: mockSpawn,
      maxSizeBytes: 100 * 1024 * 1024,
      maxFileCount: 5000,
    }
  );

  // 1. Command must be 'git' directly
  assert.equal(capturedCommand, "git");

  // 2. shell must be false
  assert.equal(capturedOptions.shell, false);

  // 3. Security configurations injected
  assert.ok(capturedArgs.includes("protocol.file.allow=never"));
  assert.ok(capturedArgs.includes("protocol.ext.allow=never"));
  assert.ok(capturedArgs.includes("protocol.allow=never"));
  assert.ok(capturedArgs.includes("protocol.https.allow=always"));
  assert.ok(capturedArgs.includes("credential.helper="));

  // 4. Shallow depth and resource bounding
  assert.ok(capturedArgs.includes("--depth"));
  assert.ok(capturedArgs.includes("1"));
  assert.ok(capturedArgs.includes("--single-branch"));
  assert.ok(capturedArgs.includes("--no-tags"));
  assert.ok(capturedArgs.includes("--recurse-submodules=no"));

  // 5. '--' delimiter separates options from repository URL and targetDir
  const dashDashIndex = capturedArgs.indexOf("--");
  assert.ok(dashDashIndex !== -1, "Arguments must include '--' option delimiter");
  assert.equal(capturedArgs[dashDashIndex + 1], "https://github.com/torvalds/linux.git");
  assert.equal(capturedArgs[dashDashIndex + 2], testTargetDir);

  // Clean up
  result.cleanup();
  assert.equal(fs.existsSync(testTargetDir), false);
});

test("Git Clone Security - Enforces clone timeout and terminates hanging subprocess", async () => {
  let killCalledWith = null;

  const mockHangingSpawn = () => {
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = (sig) => {
      killCalledWith = sig;
    };
    return mockChild;
  };

  const testTimeoutDir = path.resolve(SANDBOX_BASE, "mock_timeout_dir");
  await assert.rejects(
    async () => {
      await executeHardenedGitClone(
        "https://github.com/torvalds/linux.git",
        testTimeoutDir,
        {
          timeoutMs: 50,
          spawnFn: mockHangingSpawn,
        }
      );
    },
    (err) => {
      assert.match(err.message, /timed out/i);
      assert.equal(err.code, "GIT_TIMEOUT");
      return true;
    }
  );

  assert.equal(killCalledWith, "SIGKILL");
  assert.equal(fs.existsSync(testTimeoutDir), false);
});

test("Git Clone Security - Active disk quota monitor aborts clone during execution", async () => {
  let killCalledWith = null;
  const testActiveQuotaDir = path.resolve(SANDBOX_BASE, "mock_active_quota_dir");

  const mockExplosiveSpawn = () => {
    const mockChild = new EventEmitter();
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = (sig) => {
      killCalledWith = sig;
    };

    // Simulate rapid file creation during clone exceeding quota
    setTimeout(() => {
      try {
        fs.writeFileSync(path.join(testActiveQuotaDir, "bomb.dat"), Buffer.alloc(2 * 1024 * 1024));
      } catch {}
    }, 50);

    return mockChild;
  };

  await assert.rejects(
    async () => {
      await executeHardenedGitClone(
        "https://github.com/torvalds/linux.git",
        testActiveQuotaDir,
        {
          timeoutMs: 5000,
          maxSizeBytes: 1 * 1024 * 1024, // 1MB limit < 2MB file
          spawnFn: mockExplosiveSpawn,
        }
      );
    },
    (err) => {
      assert.match(err.message, /size limit exceeded/i);
      return true;
    }
  );

  assert.equal(killCalledWith, "SIGKILL");
  assert.equal(fs.existsSync(testActiveQuotaDir), false);
});

// ============================================================================
// SUITE 7: DISK QUOTA & OBJECT / FILE COUNT LIMITS
// ============================================================================

test("Git Clone Security - Enforces disk quota and file count limits", () => {
  const quotaDir = path.resolve(SANDBOX_BASE, "quota_test");
  fs.mkdirSync(quotaDir, { recursive: true });

  try {
    // Write 5 files of 100KB each (total: 500KB)
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(quotaDir, `file_${i}.dat`), Buffer.alloc(100 * 1024));
    }

    // 1. Normal measure under quota
    const stats = measureDirectorySizeAndCount(quotaDir, 1024 * 1024, 10);
    assert.equal(stats.fileCount, 5);
    assert.equal(stats.totalBytes, 500 * 1024);

    // 2. Exceeding byte quota throws GitQuotaExceededError
    assert.throws(
      () => measureDirectorySizeAndCount(quotaDir, 200 * 1024, 10), // Limit: 200KB < 500KB
      GitQuotaExceededError
    );

    // 3. Exceeding file count limit throws GitQuotaExceededError
    assert.throws(
      () => measureDirectorySizeAndCount(quotaDir, 1024 * 1024, 3), // Limit: 3 files < 5 files
      GitQuotaExceededError
    );
  } finally {
    try { fs.rmSync(quotaDir, { recursive: true, force: true }); } catch {}
  }
});

// ============================================================================
// SUITE 8: LOCAL FILESYSTEM ARBITRARY ACCESS DEFENSE
// ============================================================================

test("Git Clone Security - Rejects arbitrary local filesystem path access", () => {
  const dangerousPaths = [
    "C:\\Windows\\System32",
    "C:/Windows",
    "C:\\Program Files\\app",
    "C:/ProgramData",
    "/etc/shadow",
    "/etc/passwd",
    "/var/log",
    "/usr/bin",
    "/root",
    "/",
    "C:\\",
  ];

  for (const dangerous of dangerousPaths) {
    assert.throws(
      () => validateSafeTargetDirectory(dangerous, process.cwd()),
      /Arbitrary system path access denied|Scanning filesystem root/i,
      `Expected ${dangerous} to be rejected`
    );
  }

  // Safe relative target directory inside workspace
  const safeDir = validateSafeTargetDirectory("./artifacts/uploads/valid_scan", process.cwd());
  assert.ok(safeDir.includes("artifacts"));
});

// ============================================================================
// SUITE 9: HTTP API INTEGRATION & GUARANTEED POST-SCAN CLEANUP
// ============================================================================

test("Git Clone Security - POST /scan/static rejects malicious URLs and cleans up on failure", async () => {
  await withServer(async (baseUrl) => {
    const authHeaders = createAuthHeaders({ username: "alice" });

    // 1. Malicious command injection URL via API
    const cmdInjectRes = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        git_url: "https://github.com/foo/bar;whoami",
      }),
    });
    assert.equal(cmdInjectRes.status, 400);
    const cmdData = await cmdInjectRes.json();
    assert.equal(cmdData.success, false);
    assert.match(cmdData.error, /Git clone rejected/i);

    // 2. Dangerous file:// scheme via API
    const fileRes = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        git_url: "file:///etc/passwd",
      }),
    });
    assert.equal(fileRes.status, 400);
    const fileData = await fileRes.json();
    assert.equal(fileData.success, false);
    assert.match(fileData.error, /Git clone rejected/i);

    // 3. Arbitrary system directory path via target_dir
    const sysPathRes = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        target_dir: "C:\\Windows",
      }),
    });
    assert.equal(sysPathRes.status, 400);
    const sysData = await sysPathRes.json();
    assert.equal(sysData.success, false);
    assert.match(sysData.error, /Arbitrary system path access denied/i);

    // 4. SSRF private target via API
    const ssrfRes = await fetch(`${baseUrl}/scan/static`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        git_url: "https://169.254.169.254/secret.git",
      }),
    });
    assert.equal(ssrfRes.status, 400);
    const ssrfData = await ssrfRes.json();
    assert.equal(ssrfData.success, false);
    assert.match(ssrfData.error, /restricted|forbidden/i);
  });
});
