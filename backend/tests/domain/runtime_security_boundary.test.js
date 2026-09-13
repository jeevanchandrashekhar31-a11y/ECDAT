const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SecurityBoundaryViolation,
  KernelCompatibilityError,
  AgentResourceLimits,
  BoundedEventBuffer,
  AgentWatchdog,
  KernelCompatibilityValidator,
  RuntimeSecurityAgent,
} = require("../../src/domain/runtime_security_boundary");

const { SensitiveDataExposureError } = require("../../src/domain/runtime_discovery");

test("Strict Allowlist Probes - allows cataloged probe and rejects unauthorized ones", () => {
  const agent = new RuntimeSecurityAgent();

  const attachment = agent.attachProbe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3");
  assert.equal(attachment.isAttached, true);
  assert.equal(attachment.functionName, "EVP_EncryptInit_ex");
  assert.ok(agent.attachedProbes.has("openssl_evp_encrypt_init_ex"));

  // Unauthorized probe rejection
  assert.throws(
    () => {
      agent.attachProbe("arbitrary_hacker_probe", "/bin/sh");
    },
    {
      name: "SecurityBoundaryViolation",
      message: /is NOT in the allowlisted runtime probes catalog/,
    }
  );
});

test("Kernel Compatibility Validator - parses version and checks platform", () => {
  const [maj, min, patch] = KernelCompatibilityValidator.parseKernelVersion("5.15.0-generic");
  assert.equal(maj, 5);
  assert.equal(min, 15);
  assert.equal(patch, 0);

  // Kernel rejection for old kernel (< 5.8)
  const checkOld = KernelCompatibilityValidator.validateKernel("4.19.0-6-amd64", "5.8.0");
  assert.equal(checkOld.isCompatible, false);
});

test("Resource Limits & Bounded Event Buffer - drops oldest on overflow", () => {
  const buffer = new BoundedEventBuffer(3);
  for (let i = 0; i < 5; i++) {
    buffer.push({ index: i, parameters: { cipher: "AES" } });
  }

  assert.equal(buffer.size(), 3);
  assert.equal(buffer.droppedCount, 2);
  assert.equal(buffer.totalEnqueued, 5);

  const batch = buffer.popBatch(10);
  assert.equal(batch.length, 3);
  assert.equal(batch[0].index, 2);
  assert.equal(batch[2].index, 4);
});

test("Rate Limiting - limits max events per second", () => {
  const limits = new AgentResourceLimits({ maxEventsPerSecond: 5 });
  const agent = new RuntimeSecurityAgent({ limits });

  let enqueued = 0;
  for (let i = 0; i < 15; i++) {
    const ok = agent.ingestRawEvent({
      function_name: "EVP_EncryptInit_ex",
      parameters: { cipher_name: "AES-256-GCM" },
    });
    if (ok) enqueued++;
  }

  assert.equal(enqueued, 5);
});

test("Acceptance Criterion - Compromised application sending secrets trips breaker without compromising control plane", () => {
  const agent = new RuntimeSecurityAgent();
  agent.attachProbe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3");
  assert.equal(agent.attachedProbes.size, 1);

  // Compromised app sends private key in parameters
  const maliciousEvent = {
    function_name: "EVP_EncryptInit_ex",
    parameters: {
      private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y18V...",
    },
  };

  assert.throws(
    () => {
      agent.ingestRawEvent(maliciousEvent);
    },
    {
      name: "SensitiveDataExposureError",
    }
  );

  // Verify breaker tripped and all probes detached
  assert.equal(agent.circuitBreakerTripped, true);
  assert.ok(agent.circuitBreakerReason.includes("Sensitive data exposure attempt"));
  assert.equal(agent.attachedProbes.size, 0);

  // Subsequent probe attachment is blocked
  assert.throws(
    () => {
      agent.attachProbe("openssl_evp_digest_init_ex", "/usr/lib/libcrypto.so.3");
    },
    {
      name: "SecurityBoundaryViolation",
      message: /Agent circuit breaker is TRIPPED/,
    }
  );
});

test("Watchdog & Clean Detach - monitor heartbeat and detach all probes", () => {
  let called = false;
  const watchdog = new AgentWatchdog(0.05, () => {
    called = true;
  });

  watchdog.heartbeat();
  assert.equal(watchdog.checkHealth(), true);

  setTimeout(() => {
    assert.equal(watchdog.checkHealth(), false);
    assert.equal(called, true);
  }, 70);

  const agent = new RuntimeSecurityAgent();
  agent.attachProbe("openssl_evp_encrypt_init_ex", "/usr/lib/libcrypto.so.3");
  agent.attachProbe("openssl_evp_digest_init_ex", "/usr/lib/libcrypto.so.3");
  assert.equal(agent.attachedProbes.size, 2);

  const count = agent.detachAllProbes();
  assert.equal(count, 2);
  assert.equal(agent.attachedProbes.size, 0);

  const report = agent.getStatusReport();
  assert.equal(report.attached_probes_count, 0);
});
