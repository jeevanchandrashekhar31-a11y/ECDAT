/**
 * Phase 24.1: Container Hardening Backend Test Suite
 *
 * Validates production container hardening invariants:
 * - Minimal base images with pinned immutable digests
 * - Non-root execution
 * - Read-only root filesystem with tmpfs mounts
 * - Dropped capabilities (ALL)
 * - Seccomp and AppArmor profiles
 * - Resource and PIDs limits
 * - Periodic healthchecks
 * - Zero privileged containers and zero host networking
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("Phase 24.1 — Container Hardening (Backend)", () => {
  const backendDockerfile = path.join(REPO_ROOT, "backend/Dockerfile");
  const frontendDockerfile = path.join(REPO_ROOT, "frontend/Dockerfile");
  const scannerDockerfile = path.join(REPO_ROOT, "docker/scanner.Dockerfile");
  const ebpfAgentDockerfile = path.join(REPO_ROOT, "docker/ebpf-agent.Dockerfile");
  const composeFile = path.join(REPO_ROOT, "docker-compose.yml");
  const seccompFile = path.join(REPO_ROOT, "docker/security/seccomp-profile.json");
  const apparmorFile = path.join(REPO_ROOT, "docker/security/apparmor-ecdat.profile");
  const allDockerfiles = [backendDockerfile, frontendDockerfile, scannerDockerfile, ebpfAgentDockerfile];

  test("Dockerfiles: Enforces minimal base images with immutable sha256 digests", () => {
    for (const dfPath of allDockerfiles) {
      const content = fs.readFileSync(dfPath, "utf-8");
      assert.match(content, /FROM\s+[a-zA-Z0-9_\-\.\/:]+@sha256:[a-f0-9]{64}/i, `Missing pinned sha256 digest in ${dfPath}`);
      assert.match(content, /(alpine|slim|distroless)/i, `Base image is not minimal in ${dfPath}`);
    }
  });

  test("Dockerfiles: Enforces non-root USER instruction", () => {
    const backend = fs.readFileSync(backendDockerfile, "utf-8");
    assert.match(backend, /USER\s+node\b/);

    const frontend = fs.readFileSync(frontendDockerfile, "utf-8");
    assert.match(frontend, /USER\s+nginx\b/);

    const scanner = fs.readFileSync(scannerDockerfile, "utf-8");
    assert.match(scanner, /USER\s+ecdat\b/);

    const ebpfAgent = fs.readFileSync(ebpfAgentDockerfile, "utf-8");
    assert.match(ebpfAgent, /USER\s+ecdat-agent\b/);
  });

  test("Dockerfiles: Enforces healthcheck instruction", () => {
    for (const dfPath of allDockerfiles) {
      const content = fs.readFileSync(dfPath, "utf-8");
      assert.match(content, /HEALTHCHECK\s+/);
    }
  });

  test("Dockerfiles: Enforces zero compiler toolchain in runtime images", () => {
    for (const dfPath of allDockerfiles) {
      const content = fs.readFileSync(dfPath, "utf-8");
      // Check that runtime stage does not execute package manager compiler installations
      assert.ok(!content.match(/apt-get install.*(gcc|g\+\+|clang|build-essential)/i), `Compiler installed in ${dfPath}`);
      assert.ok(!content.match(/apk add.*(gcc|g\+\+|clang|build-base)/i), `Compiler installed in ${dfPath}`);
    }
  });

  test("Dockerfiles: Enforces zero secrets or private keys in build context (.dockerignore)", () => {
    for (const dfPath of allDockerfiles) {
      const content = fs.readFileSync(dfPath, "utf-8");
      assert.ok(!content.match(/COPY\s+.*\.env\b/i), `Copying .env file in ${dfPath}`);
      assert.ok(!content.match(/COPY\s+.*\.pem\b/i), `Copying .pem file in ${dfPath}`);
      assert.ok(!content.match(/COPY\s+.*\.key\b/i), `Copying .key file in ${dfPath}`);
    }

    const dockerignore = fs.readFileSync(path.join(REPO_ROOT, ".dockerignore"), "utf-8");
    assert.ok(dockerignore.includes(".env"), ".dockerignore must exclude .env");
    assert.ok(dockerignore.includes("*.pem"), ".dockerignore must exclude *.pem");
    assert.ok(dockerignore.includes("*.key"), ".dockerignore must exclude *.key");
    assert.ok(dockerignore.includes(".keys"), ".dockerignore must exclude .keys");
  });

  test("docker-compose: read_only: true with tmpfs mounts", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    assert.ok(content.includes("read_only: true"));
    assert.ok(content.includes("tmpfs:"));
    assert.ok(content.includes("/tmp:size="));
  });

  test("docker-compose: Drops all Linux capabilities (cap_drop: [ALL])", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    assert.ok(content.includes("cap_drop:"));
    assert.ok(content.includes("- ALL"));
  });

  test("docker-compose: Enforces seccomp and AppArmor profiles without unconfined", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    assert.ok(content.includes("seccomp=docker/security/seccomp-profile.json"));
    assert.ok(content.includes("no-new-privileges:true"));
    assert.ok(!content.includes("seccomp:unconfined"), "seccomp:unconfined is strictly forbidden!");
  });

  test("docker-compose: Strict resource limits and pids_limit bounds", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    assert.ok(content.includes("limits:"));
    assert.ok(content.includes("cpus:"));
    assert.ok(content.includes("memory:"));
    assert.ok(content.includes("pids_limit:"));
  });

  test("docker-compose: Disallows privileged mode and host networking", () => {
    const content = fs.readFileSync(composeFile, "utf-8");
    assert.ok(!content.includes("privileged: true"), "privileged: true detected!");
    assert.ok(content.includes("privileged: false"));
    assert.ok(!content.includes("network_mode: host") && !content.includes("network_mode: \"host\""), "Host networking detected!");
  });

  test("Security Profiles: Seccomp and AppArmor definitions are valid", () => {
    const seccomp = JSON.parse(fs.readFileSync(seccompFile, "utf-8"));
    assert.strictEqual(seccomp.defaultAction, "SCMP_ACT_ERRNO");
    assert.ok(Array.isArray(seccomp.syscalls) && seccomp.syscalls.length > 0);

    const apparmor = fs.readFileSync(apparmorFile, "utf-8");
    assert.ok(apparmor.includes("profile ecdat-profile"));
    assert.ok(apparmor.includes("deny capability sys_admin"));
  });
});
