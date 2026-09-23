/**
 * ECDAT Git Clone Security Guard Subsystem — Phase 9
 *
 * Enforces rigorous security controls for all Git cloning operations:
 * - No shell interpolation (`shell: false`)
 * - Strict argument arrays with option injection defenses ('--' delimiter)
 * - Allowed protocols only (strictly https:, optional http:)
 * - Rejection of dangerous Git helper schemes (file://, ext::, fd::, bundle::, git@, ssh://)
 * - Timeout enforcement with robust process termination
 * - Disk quota & repository size limit (active monitoring during clone)
 * - Object / file count limits
 * - Mandatory shallow depth limits (--depth 1, --single-branch, --no-tags, --recurse-submodules=no)
 * - Dedicated temporary directory sandbox isolation
 * - Guaranteed post-scan cleanup
 * - Zero credential leakage (redaction of tokens/passwords from URLs and stderr)
 * - Prevention of arbitrary local filesystem path access
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { URL } = require("url");
const { resolveAndValidateTarget } = require("./ssrf_protection");

// Default Limits
const DEFAULT_CLONE_TIMEOUT_MS = 60000;
const MAX_CLONE_TIMEOUT_MS = 120000;
const DEFAULT_MAX_REPO_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB
const DEFAULT_MAX_FILE_COUNT = 100000; // 100,000 files

// Disallowed sensitive system paths for local target_dir scans
const SENSITIVE_SYSTEM_PATHS = [
  // Windows
  /^c:[\\\/]windows/i,
  /^c:[\\\/]program files/i,
  /^c:[\\\/]program files \(x86\)/i,
  /^c:[\\\/]programdata/i,
  /^c:[\\\/]users[\\\/][^\\\/]+[\\\/]ntuser/i,
  // Unix
  /^\/etc/i,
  /^\/var/i,
  /^\/usr/i,
  /^\/bin/i,
  /^\/sbin/i,
  /^\/boot/i,
  /^\/dev/i,
  /^\/proc/i,
  /^\/sys/i,
  /^\/root/i,
];

class GitSecurityError extends Error {
  constructor(message, code = "GIT_SECURITY_VIOLATION") {
    super(message);
    this.name = "GitSecurityError";
    this.code = code;
  }
}

class GitQuotaExceededError extends GitSecurityError {
  constructor(message) {
    super(message, "GIT_QUOTA_EXCEEDED");
    this.name = "GitQuotaExceededError";
  }
}

/**
 * Scrubs credentials (e.g. https://user:pass@host) from error messages and logs.
 */
function redactCredentials(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/(https?:\/\/)([^:@\s]+):([^@\s]+)@/gi, "$1***:***@");
}

/**
 * Validates a remote Git clone URL against dangerous protocols, command injection,
 * option injection, and SSRF destinations.
 *
 * @param {string} rawUrl
 * @param {object} [options={}]
 * @param {boolean} [options.allowInsecureHttp=false]
 * @param {Function} [options.dnsLookupFn]
 * @returns {Promise<{ safe: boolean, normalizedUrl?: string, hostname?: string, error?: string }>}
 */
async function validateGitCloneUrl(rawUrl, options = {}) {
  const { allowInsecureHttp = false, dnsLookupFn } = options;

  if (!rawUrl || typeof rawUrl !== "string") {
    return { safe: false, error: "Git repository URL must be a non-empty string" };
  }

  let clean = rawUrl.trim();

  // 1. Reject command injection metacharacters, control bytes, and shell operators
  if (/[\x00\r\n;`$|&<>]/.test(clean)) {
    return { safe: false, error: "Git URL contains illegal shell metacharacters or control bytes" };
  }

  // 2. Reject option injection (arguments starting with '-')
  if (clean.startsWith("-")) {
    return { safe: false, error: "Git URL cannot start with '-' (option injection defense)" };
  }

  // 3. Reject local filesystem paths, Windows drive letters, UNC shares, and relative paths
  if (
    clean.startsWith("file://") ||
    clean.startsWith("ext::") ||
    clean.startsWith("fd::") ||
    clean.startsWith("bundle::") ||
    clean.startsWith("/") ||
    clean.startsWith("./") ||
    clean.startsWith("../") ||
    /^[a-zA-Z]:[\\/]/.test(clean) ||
    clean.startsWith("\\\\")
  ) {
    return { safe: false, error: "Local filesystem paths and dangerous helper schemes are strictly prohibited" };
  }

  // 4. Reject SCP-style and SSH protocols (git@, ssh://, git://) to prevent SSH command execution
  if (clean.startsWith("git@") || clean.startsWith("ssh://") || clean.startsWith("git://")) {
    return {
      safe: false,
      error: "SSH and git native protocols are prohibited. Only secure HTTPS repository URLs are permitted.",
    };
  }

  // Normalize URLs missing https:// (e.g. github.com/owner/repo)
  if (!clean.startsWith("https://") && !clean.startsWith("http://")) {
    if (clean.includes("/") && !clean.startsWith("/")) {
      clean = `https://${clean}`;
    } else {
      return { safe: false, error: "Git repository URL must use the 'https://' protocol scheme." };
    }
  }

  let parsed;
  try {
    parsed = new URL(clean);
  } catch {
    return { safe: false, error: "Malformed Git repository URL" };
  }

  // 5. Enforce protocol allowlist
  const protocol = parsed.protocol.toLowerCase();
  const allowedProtocols = allowInsecureHttp ? ["https:", "http:"] : ["https:"];
  if (!allowedProtocols.includes(protocol)) {
    return {
      safe: false,
      error: `Protocol '${parsed.protocol}' is prohibited for Git cloning. Allowed: ${allowedProtocols.join(", ")}`,
    };
  }

  // 6. Embedded credentials protection
  if (parsed.username || parsed.password) {
    if (!options.allowCredentials) {
      return {
        safe: false,
        error: "Embedded credentials in Git repository URLs are prohibited unless explicitly authorized.",
      };
    }
    // If explicitly authorized, strip credentials from URL to prevent leakage in logs or process arguments
    parsed.username = "";
    parsed.password = "";
    clean = parsed.toString();
  }

  const hostname = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : (protocol === "http:" ? 80 : 443);

  // 7. SSRF & Destination DNS Validation (blocks loopback, RFC 1918, cloud metadata, internal DNS targets)
  const targetCheck = await resolveAndValidateTarget(`${hostname}:${port}`, {
    defaultPort: port,
    allowPrivate: false,
    dnsLookupFn,
  });

  if (!targetCheck.valid) {
    return { safe: false, error: `Git remote destination rejected: ${targetCheck.error}` };
  }

  return {
    safe: true,
    normalizedUrl: clean,
    hostname: targetCheck.hostname,
    port: targetCheck.port,
    pinnedIp: targetCheck.pinnedIp,
  };
}

/**
 * Validates and sanitizes a Git branch name against option injection and path traversal.
 */
function sanitizeBranchName(branch) {
  if (!branch || typeof branch !== "string") return null;
  const trimmed = branch.trim();
  if (!trimmed) return null;

  // Must not start with '-' (option injection)
  if (trimmed.startsWith("-")) {
    throw new GitSecurityError(`Invalid branch name '${trimmed}': Branch cannot start with '-'`);
  }

  // Strict allowlist: alphanumeric, dot, underscore, slash, hyphen
  if (!/^[a-zA-Z0-9._\/-]+$/.test(trimmed)) {
    throw new GitSecurityError(`Invalid branch name '${trimmed}': Contains disallowed characters`);
  }

  // Path traversal check
  if (trimmed.includes("..")) {
    throw new GitSecurityError(`Invalid branch name '${trimmed}': Path traversal sequence '..' is prohibited`);
  }

  return trimmed;
}

/**
 * Recursively calculates total disk size in bytes and file count of a directory.
 */
function measureDirectorySizeAndCount(dirPath, maxSizeBytes = Infinity, maxFileCount = Infinity) {
  let totalBytes = 0;
  let fileCount = 0;

  function walk(current) {
    if (!fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      // Handle symlinks safely: do not follow escaping symlinks
      if (entry.isSymbolicLink()) {
        fileCount++;
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        fileCount++;
        try {
          const stats = fs.statSync(fullPath);
          totalBytes += stats.size;
        } catch {}

        if (totalBytes > maxSizeBytes) {
          throw new GitQuotaExceededError(
            `Repository size limit exceeded: Directory reached ${Math.round(totalBytes / 1024 / 1024)}MB (max: ${Math.round(maxSizeBytes / 1024 / 1024)}MB)`
          );
        }

        if (fileCount > maxFileCount) {
          throw new GitQuotaExceededError(
            `Repository file count limit exceeded: Directory contains ${fileCount} files (max: ${maxFileCount})`
          );
        }
      }
    }
  }

  walk(dirPath);
  return { totalBytes, fileCount };
}

/**
 * Validates that an explicit local target_dir does not access arbitrary or sensitive system paths.
 */
function validateSafeTargetDirectory(targetDir, baseWorkspaceDir) {
  if (!targetDir || typeof targetDir !== "string") {
    throw new GitSecurityError("Target directory must be a non-empty string");
  }

  const clean = targetDir.trim().replace(/^['"]|['"]$/g, "");
  if (clean.includes("\x00")) {
    throw new GitSecurityError("Target directory contains illegal null byte");
  }

  const normalized = clean.replace(/\\/g, "/").toLowerCase();

  // 1. Cross-platform check against sensitive system roots and directories
  if (
    normalized === "/" ||
    normalized === "c:/" ||
    normalized.startsWith("/etc") ||
    normalized.startsWith("/var") ||
    normalized.startsWith("/usr") ||
    normalized.startsWith("/bin") ||
    normalized.startsWith("/sbin") ||
    normalized.startsWith("/proc") ||
    normalized.startsWith("/sys") ||
    normalized.startsWith("/root") ||
    normalized.startsWith("/dev") ||
    normalized.startsWith("/boot") ||
    normalized.startsWith("c:/windows") ||
    normalized.startsWith("c:/program files") ||
    normalized.startsWith("c:/program files (x86)") ||
    normalized.startsWith("c:/programdata")
  ) {
    throw new GitSecurityError(
      `Arbitrary system path access denied: '${clean}' targets a restricted operating system directory.`
    );
  }

  const resolved = path.resolve(clean);

  // 2. Check against resolved path regexes
  for (const pattern of SENSITIVE_SYSTEM_PATHS) {
    if (pattern.test(resolved)) {
      throw new GitSecurityError(
        `Arbitrary system path access denied: '${clean}' targets a restricted operating system directory.`
      );
    }
  }

  // 3. Disallow filesystem root paths (e.g. C:\ or /)
  const root = path.parse(resolved).root;
  if (resolved === root) {
    throw new GitSecurityError("Scanning filesystem root directory is prohibited.");
  }

  return resolved;
}

/**
 * Executes a hardened Git clone subprocess with strict security constraints:
 * - shell: false
 * - Strict argument array with option injection defenses
 * - Protocol isolation configs
 * - Active disk quota monitoring
 * - Post-clone file count & size validation
 * - Process timeout & clean termination
 * - Credential sanitization
 *
 * @param {string} repoUrl - Remote Git URL
 * @param {string} targetDir - Isolated temporary target directory
 * @param {object} [options={}]
 * @returns {Promise<{ stdout: string, stderr: string, targetDir: string, cleanup: Function }>}
 */
async function executeHardenedGitClone(repoUrl, targetDir, options = {}) {
  const {
    branch = null,
    timeoutMs = DEFAULT_CLONE_TIMEOUT_MS,
    maxSizeBytes = DEFAULT_MAX_REPO_SIZE_BYTES,
    maxFileCount = DEFAULT_MAX_FILE_COUNT,
    allowInsecureHttp = false,
    dnsLookupFn,
    spawnFn = spawn,
  } = options;

  const boundedTimeout = Math.min(Math.max(timeoutMs, 1000), MAX_CLONE_TIMEOUT_MS);

  // Step 1: Strict URL Validation
  const urlCheck = await validateGitCloneUrl(repoUrl, {
    allowInsecureHttp,
    dnsLookupFn,
    allowCredentials: options.allowCredentials,
  });
  if (!urlCheck.safe) {
    throw new GitSecurityError(`Git clone rejected for security: ${urlCheck.error}`);
  }
  const cleanUrl = urlCheck.normalizedUrl;

  // Step 2: Branch sanitization
  let sanitizedBranch = null;
  if (branch) {
    sanitizedBranch = sanitizeBranchName(branch);
  }

  // Step 3: Target directory preparation
  const resolvedTarget = path.resolve(targetDir);
  try {
    if (fs.existsSync(resolvedTarget)) {
      fs.rmSync(resolvedTarget, { recursive: true, force: true });
    }
    fs.mkdirSync(resolvedTarget, { recursive: true });
  } catch (err) {
    throw new GitSecurityError(`Failed to initialize clone sandbox directory: ${err.message}`);
  }

  // Cleanup helper
  const cleanup = () => {
    try {
      if (fs.existsSync(resolvedTarget)) {
        fs.rmSync(resolvedTarget, { recursive: true, force: true });
      }
    } catch {}
  };

  // Step 4: Strict Argument Array
  // Note: -c protocol.file.allow=never strictly blocks local file exploitation via submodules/redirects
  // Note: -c credential.helper= disables any system credential helper that might leak host credentials
  // Note: '--' ensures cleanUrl and resolvedTarget are never treated as flags even if starting with '-'
  const cloneArgs = [
    "-c", "protocol.file.allow=never",
    "-c", "protocol.ext.allow=never",
    "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always",
    "-c", "credential.helper=",
  ];

  if (allowInsecureHttp) {
    cloneArgs.push("-c", "protocol.http.allow=always");
  }

  cloneArgs.push(
    "clone",
    "--depth", "1",
    "--single-branch",
    "--no-tags",
    "--recurse-submodules=no",
    "--filter=blob:limit=50m"
  );

  if (sanitizedBranch) {
    cloneArgs.push("-b", sanitizedBranch);
  }

  cloneArgs.push("--", cleanUrl, resolvedTarget);

  // Step 5: Execute spawn with shell: false and active quota monitor
  return new Promise((resolve, reject) => {
    let child;
    let stdout = "";
    let stderr = "";
    let quotaTimer = null;
    let processTimer = null;
    let terminated = false;

    const killProcess = (reason) => {
      if (terminated) return;
      terminated = true;
      if (quotaTimer) clearInterval(quotaTimer);
      if (processTimer) clearTimeout(processTimer);

      try {
        if (child && !child.killed) {
          child.kill("SIGKILL");
        }
      } catch {}

      cleanup();
    };

    try {
      child = spawnFn("git", cloneArgs, {
        shell: false,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",      // Never prompt for credentials interactively
          GIT_ASKPASS: "echo",            // Avoid credential prompts hanging
          GIT_HTTP_MAX_REQUESTS: "5",     // Limit simultaneous HTTP requests
        },
      });
    } catch (spawnErr) {
      cleanup();
      return reject(new GitSecurityError(`Failed to spawn git process: ${spawnErr.message}`));
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    // Active disk quota growth monitor (checks every 500ms)
    quotaTimer = setInterval(() => {
      try {
        measureDirectorySizeAndCount(resolvedTarget, maxSizeBytes, maxFileCount);
      } catch (quotaErr) {
        killProcess(quotaErr.message);
        reject(quotaErr);
      }
    }, 500);

    // Timeout guard
    processTimer = setTimeout(() => {
      killProcess("timeout");
      reject(
        new GitSecurityError(`Git clone timed out after ${boundedTimeout}ms (timeout limit exceeded)`, "GIT_TIMEOUT")
      );
    }, boundedTimeout);

    child.on("close", (code) => {
      if (quotaTimer) clearInterval(quotaTimer);
      if (processTimer) clearTimeout(processTimer);
      if (terminated) return;

      const sanitizedStderr = redactCredentials(stderr);
      const sanitizedStdout = redactCredentials(stdout);

      if (code === 0) {
        // Step 6: Post-clone verification of quota and file limits
        try {
          measureDirectorySizeAndCount(resolvedTarget, maxSizeBytes, maxFileCount);
          resolve({
            stdout: sanitizedStdout,
            stderr: sanitizedStderr,
            targetDir: resolvedTarget,
            cleanup,
          });
        } catch (postCloneErr) {
          cleanup();
          reject(postCloneErr);
        }
      } else {
        cleanup();
        reject(
          new GitSecurityError(
            `Git clone failed (exit code ${code}): ${sanitizedStderr || sanitizedStdout || "Unknown git error"}`
          )
        );
      }
    });

    child.on("error", (err) => {
      killProcess(err.message);
      reject(new GitSecurityError(`Git subprocess error: ${redactCredentials(err.message)}`));
    });
  });
}

module.exports = {
  GitSecurityError,
  GitQuotaExceededError,
  validateGitCloneUrl,
  sanitizeBranchName,
  measureDirectorySizeAndCount,
  validateSafeTargetDirectory,
  executeHardenedGitClone,
  redactCredentials,
  DEFAULT_CLONE_TIMEOUT_MS,
  DEFAULT_MAX_REPO_SIZE_BYTES,
  DEFAULT_MAX_FILE_COUNT,
};
