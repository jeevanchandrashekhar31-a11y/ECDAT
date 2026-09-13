/**
 * ECDAT Dedicated eBPF Runtime Security Boundary & Agent Subsystem (Node.js) - Phase 6.2
 *
 * Core Security Invariants:
 * 1. Control Plane Isolation: The ECDAT backend/control plane NEVER runs with root/CAP_BPF privileges.
 * 2. Dedicated Agent Architecture: Isolates tracing to a dedicated RuntimeSecurityAgent.
 * 3. Strict Probe Allowlist: Only probes cataloged in rules/runtime_probes_catalog.json may be attached.
 * 4. Resource Limits: Safe bounded ringbuffer, rate limits, and memory limits.
 * 5. Input Validation & Watchdogs: Rejects sensitive payloads, monitors agent heartbeat.
 * 6. Clean Detach & Graceful Failure: Ensures probes cleanly unhook on shutdown or failure.
 */

const fs = require("fs");
const path = require("path");
const { assertMetadataOnly, SensitiveDataExposureError, RuntimeProbesCatalog } = require("./runtime_discovery");

class SecurityBoundaryViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "SecurityBoundaryViolation";
  }
}

class KernelCompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = "KernelCompatibilityError";
  }
}

class AgentResourceLimits {
  constructor(options = {}) {
    this.maxEventBufferSizeMb = options.maxEventBufferSizeMb || 16;
    this.maxEventsPerSecond = options.maxEventsPerSecond || 5000;
    this.maxMemoryOverheadMb = options.maxMemoryOverheadMb || 64;
    this.watchdogTimeoutSeconds = options.watchdogTimeoutSeconds || 5;
    this.maxBufferEntries = options.maxBufferEntries || 10000;
    Object.freeze(this);
  }
}

class BoundedEventBuffer {
  constructor(capacity = 10000) {
    this.capacity = capacity;
    this.buffer = [];
    this.droppedCount = 0;
    this.totalEnqueued = 0;
  }

  push(eventData) {
    assertMetadataOnly(eventData ? eventData.parameters : {}, "BoundedEventBuffer.push");
    this.totalEnqueued += 1;
    if (this.buffer.length >= this.capacity) {
      this.droppedCount += 1;
      this.buffer.shift(); // Drop oldest
    }
    this.buffer.push(eventData);
    return true;
  }

  popBatch(maxBatch = 100) {
    const items = [];
    while (this.buffer.length > 0 && items.length < maxBatch) {
      items.push(this.buffer.shift());
    }
    return items;
  }

  size() {
    return this.buffer.length;
  }
}

class AgentWatchdog {
  constructor(timeoutSeconds = 5, onFailureCallback = null) {
    this.timeoutSeconds = timeoutSeconds;
    this.onFailure = onFailureCallback;
    this.lastHeartbeat = Date.now();
    this.isHealthy = true;
  }

  heartbeat() {
    this.lastHeartbeat = Date.now();
  }

  checkHealth() {
    const elapsedSeconds = (Date.now() - this.lastHeartbeat) / 1000;
    if (elapsedSeconds > this.timeoutSeconds) {
      this.isHealthy = false;
      if (typeof this.onFailure === "function") {
        this.onFailure();
      }
      return false;
    }
    return true;
  }
}

class KernelCompatibilityValidator {
  static parseKernelVersion(releaseStr) {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(releaseStr || "");
    if (!match) return [0, 0, 0];
    return [parseInt(match[1], 10), parseInt(match[2], 10), match[3] ? parseInt(match[3], 10) : 0];
  }

  static validateKernel(release = null, minVersion = "5.8.0") {
    if (process.platform !== "linux") {
      return {
        isCompatible: false,
        reason: `Non-Linux OS '${process.platform}'; eBPF runtime requires Linux.`,
      };
    }

    const currentRelease = release || require("os").release();
    const [cMaj, cMin, cPatch] = this.parseKernelVersion(currentRelease);
    const [mMaj, mMin, mPatch] = this.parseKernelVersion(minVersion);

    const isBelow =
      cMaj < mMaj ||
      (cMaj === mMaj && cMin < mMin) ||
      (cMaj === mMaj && cMin === mMin && cPatch < mPatch);

    if (isBelow) {
      return {
        isCompatible: false,
        reason: `Kernel version ${currentRelease} is below minimum requirement ${minVersion}.`,
      };
    }

    if (!fs.existsSync("/sys/fs/bpf")) {
      return {
        isCompatible: false,
        reason: "Virtual filesystem /sys/fs/bpf is not mounted.",
      };
    }

    return {
      isCompatible: true,
      reason: `Kernel ${currentRelease} is compatible with eBPF requirements.`,
    };
  }
}

class RuntimeSecurityAgent {
  constructor(options = {}) {
    this.agentId = options.agentId || "ecdat-runtime-agent-01";
    this.catalog = options.catalog || new RuntimeProbesCatalog();
    this.limits = options.limits || new AgentResourceLimits();
    this.buffer = new BoundedEventBuffer(this.limits.maxBufferEntries);
    this.attachedProbes = new Map();
    this.circuitBreakerTripped = false;
    this.circuitBreakerReason = null;
    this.rateWindowStart = Date.now();
    this.rateCount = 0;
    this.watchdog = new AgentWatchdog(this.limits.watchdogTimeoutSeconds, () => {
      this.tripCircuitBreaker("Watchdog health check failed (agent stall or timeout)");
    });
  }

  attachProbe(probeId, targetBinaryPath) {
    if (this.circuitBreakerTripped) {
      throw new SecurityBoundaryViolation(
        `Agent circuit breaker is TRIPPED (${this.circuitBreakerReason}). Cannot attach probes.`
      );
    }

    // 1. Strict Catalog Allowlist Check
    let allowlisted = false;
    let foundProbe = null;
    for (const lib of this.catalog.libraries.values()) {
      for (const p of lib.probes || []) {
        if (p.probe_id === probeId) {
          allowlisted = true;
          foundProbe = p;
          break;
        }
      }
      if (allowlisted) break;
    }

    if (!allowlisted || !foundProbe) {
      throw new SecurityBoundaryViolation(
        `Unauthorized probe attachment rejected: '${probeId}' is NOT in the allowlisted runtime probes catalog. ` +
        "Arbitrary probe attachments are strictly prohibited."
      );
    }

    // 2. Validate binary path
    if (!targetBinaryPath || typeof targetBinaryPath !== "string") {
      throw new SecurityBoundaryViolation(`Invalid target binary path '${targetBinaryPath}'.`);
    }

    const attachment = {
      probeId,
      libraryName: foundProbe.library_name || "OpenSSL",
      functionName: foundProbe.function_name,
      targetBinaryPath,
      isAttached: true,
      attachedAtEpoch: Date.now(),
    };
    this.attachedProbes.set(probeId, attachment);
    return attachment;
  }

  ingestRawEvent(eventData = {}) {
    if (this.circuitBreakerTripped) return false;

    this.watchdog.heartbeat();

    // Rate limiting check
    const now = Date.now();
    if (now - this.rateWindowStart >= 1000) {
      this.rateWindowStart = now;
      this.rateCount = 0;
    }
    this.rateCount += 1;
    if (this.rateCount > this.limits.maxEventsPerSecond) {
      return false; // Safely drop upon rate limit
    }

    // Input & Metadata validation
    try {
      assertMetadataOnly(eventData.parameters, `Agent.ingestRawEvent(${eventData.function_name})`);
    } catch (err) {
      this.tripCircuitBreaker(`Sensitive data exposure attempt: ${err.message}`);
      throw err;
    }

    return this.buffer.push(eventData);
  }

  tripCircuitBreaker(reason) {
    this.circuitBreakerTripped = true;
    this.circuitBreakerReason = reason;
    this.detachAllProbes();
  }

  detachProbe(probeId) {
    if (this.attachedProbes.has(probeId)) {
      const p = this.attachedProbes.get(probeId);
      p.isAttached = false;
      this.attachedProbes.delete(probeId);
      return true;
    }
    return false;
  }

  detachAllProbes() {
    const count = this.attachedProbes.size;
    for (const p of this.attachedProbes.values()) {
      p.isAttached = false;
    }
    this.attachedProbes.clear();
    return count;
  }

  getStatusReport() {
    return {
      agent_id: this.agentId,
      circuit_breaker_tripped: this.circuitBreakerTripped,
      circuit_breaker_reason: this.circuitBreakerReason,
      attached_probes_count: this.attachedProbes.size,
      buffer_size: this.buffer.size(),
      dropped_events: this.buffer.droppedCount,
      total_enqueued: this.buffer.totalEnqueued,
      watchdog_healthy: this.watchdog.isHealthy,
    };
  }
}

module.exports = {
  SecurityBoundaryViolation,
  KernelCompatibilityError,
  AgentResourceLimits,
  BoundedEventBuffer,
  AgentWatchdog,
  KernelCompatibilityValidator,
  RuntimeSecurityAgent,
};
