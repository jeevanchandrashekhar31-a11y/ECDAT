/**
 * ECDAT Runtime Discovery Subsystem (Node.js) - Phase 6.1
 *
 * Goal:
 * process
 *   -> library/function
 *   -> crypto operation
 *   -> parameters (metadata only)
 *   -> application/service
 *   -> crypto asset
 *
 * Invariants:
 * 1. Optional subsystem: Gracefully disables when kernel capabilities (eBPF / uprobes)
 *    are unavailable or disabled in configuration.
 * 2. Strict metadata only: Strictly forbids capturing private keys, plaintext, passwords,
 *    tokens, or arbitrary payloads.
 * 3. First-class asset correlation: Resolves runtime events into structured dependency
 *    relationships connecting Process -> Library -> Crypto Operation -> Asset.
 */

const fs = require("fs");
const path = require("path");
const { EvidenceSource, RelationshipType } = require("./contracts");

const RuntimeCapabilityStatus = Object.freeze({
  AVAILABLE: "available",
  UNAVAILABLE_NON_LINUX: "unavailable_non_linux",
  UNAVAILABLE_NO_ROOT_OR_CAP_BPF: "unavailable_no_root_or_cap_bpf",
  UNAVAILABLE_NO_EBPF_SUPPORT: "unavailable_no_ebpf_support",
  DISABLED_BY_CONFIG: "disabled_by_config",
});

class SensitiveDataExposureError extends Error {
  constructor(message) {
    super(message);
    this.name = "SensitiveDataExposureError";
  }
}

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "private_key",
  "privatekey",
  "plaintext",
  "cleartext",
  "password",
  "passwd",
  "token",
  "secret",
  "payload",
  "raw_key",
  "key_bytes",
  "decrypted_data",
]);

const FORBIDDEN_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /-----BEGIN RSA PRIVATE KEY-----/i,
  /-----BEGIN EC PRIVATE KEY-----/i,
];

function assertMetadataOnly(data = {}, context = "runtime_event") {
  if (!data || typeof data !== "object") return;

  for (const [key, val] of Object.entries(data)) {
    const kLower = key.toLowerCase();
    if (
      FORBIDDEN_PAYLOAD_KEYS.has(kLower) ||
      kLower.includes("private_key") ||
      kLower.includes("plaintext") ||
      kLower.includes("password") ||
      kLower.includes("token") ||
      kLower.includes("payload")
    ) {
      throw new SensitiveDataExposureError(
        `Security Invariant Violation in ${context}: Forbidden sensitive field '${key}' detected. ` +
        "Runtime discovery MUST capture metadata only."
      );
    }

    if (typeof val === "string") {
      for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
        if (pattern.test(val)) {
          throw new SensitiveDataExposureError(
            `Security Invariant Violation in ${context}: Private key material detected in field '${key}'.`
          );
        }
      }
    } else if (typeof val === "object" && val !== null) {
      assertMetadataOnly(val, `${context}.${key}`);
    }
  }
}

class RuntimeCryptoEvent {
  constructor(data = {}) {
    this.processId = data.processId || 0;
    this.processName = data.processName || "unknown_process";
    this.libraryName = data.libraryName || "unknown_library";
    this.functionName = data.functionName || "unknown_function";
    this.cryptoOperation = data.cryptoOperation || "cryptographic_call";
    this.parameters = data.parameters || {};
    this.containerId = data.containerId || null;
    this.applicationName = data.applicationName || this.processName;
    this.serviceName = data.serviceName || null;
    this.timestampNs = data.timestampNs || Date.now() * 1000000;

    // Enforce metadata-only invariant
    assertMetadataOnly(this.parameters, `RuntimeCryptoEvent(${this.functionName})`);
    Object.freeze(this);
  }

  toJSON() {
    assertMetadataOnly(this.parameters, `RuntimeCryptoEvent(${this.functionName})`);
    return {
      process_id: this.processId,
      process_name: this.processName,
      library_name: this.libraryName,
      function_name: this.functionName,
      crypto_operation: this.cryptoOperation,
      parameters: this.parameters,
      container_id: this.containerId,
      application_name: this.applicationName,
      service_name: this.serviceName,
      timestamp_ns: this.timestampNs,
    };
  }
}

class KernelCapabilityChecker {
  static checkCapabilities(enabledInConfig = true) {
    if (!enabledInConfig) {
      return {
        status: RuntimeCapabilityStatus.DISABLED_BY_CONFIG,
        reason: "Runtime eBPF subsystem is disabled by configuration.",
      };
    }

    const currentPlatform = process.platform;
    if (currentPlatform !== "linux") {
      return {
        status: RuntimeCapabilityStatus.UNAVAILABLE_NON_LINUX,
        reason: `Kernel eBPF runtime collection requires Linux (detected '${currentPlatform}'). Runtime collection gracefully disabled.`,
      };
    }

    if (process.getuid && process.getuid() !== 0) {
      return {
        status: RuntimeCapabilityStatus.UNAVAILABLE_NO_ROOT_OR_CAP_BPF,
        reason: `eBPF tracing requires root or CAP_BPF privileges (uid=${process.getuid()}). Runtime collection gracefully disabled.`,
      };
    }

    if (!fs.existsSync("/sys/fs/bpf")) {
      return {
        status: RuntimeCapabilityStatus.UNAVAILABLE_NO_EBPF_SUPPORT,
        reason: "BPF virtual filesystem /sys/fs/bpf not found. Runtime collection gracefully disabled.",
      };
    }

    return {
      status: RuntimeCapabilityStatus.AVAILABLE,
      reason: "Linux kernel eBPF and uprobe capabilities verified and available.",
    };
  }
}

class RuntimeProbesCatalog {
  constructor(customPath = null) {
    this.catalogPath = customPath || path.resolve(__dirname, "../../../rules/runtime_probes_catalog.json");
    this.version = "1.0.0";
    this.libraries = new Map();
    this.functionToProbe = new Map();
    this.loadCatalog();
  }

  loadCatalog() {
    if (!fs.existsSync(this.catalogPath)) return;
    try {
      const raw = fs.readFileSync(this.catalogPath, "utf-8");
      const data = JSON.parse(raw);
      this.version = data.version || "1.0.0";
      for (const lib of data.supported_libraries || []) {
        this.libraries.set(lib.library_id, lib);
        for (const probe of lib.probes || []) {
          this.functionToProbe.set(probe.function_name.toLowerCase(), {
            ...probe,
            library_id: lib.library_id,
            library_name: lib.library_name,
          });
        }
      }
    } catch {
      // Graceful fallback
    }
  }

  lookupFunction(functionName) {
    if (!functionName || typeof functionName !== "string") return null;
    return this.functionToProbe.get(functionName.toLowerCase()) || null;
  }
}

class RuntimeObservationSubsystem {
  constructor({ enabled = true, catalog = null, capabilityChecker = null } = {}) {
    this.enabled = enabled;
    this.catalog = catalog || new RuntimeProbesCatalog();
    this.capabilityChecker = capabilityChecker || KernelCapabilityChecker;
    const check = this.capabilityChecker.checkCapabilities(this.enabled);
    this.status = check.status;
    this.statusReason = check.reason;
    this.events = [];
  }

  isOperational() {
    return this.status === RuntimeCapabilityStatus.AVAILABLE;
  }

  recordEvent({
    processId = 0,
    processName = "app",
    libraryName = "OpenSSL",
    functionName = "SSL_do_handshake",
    cryptoOperation = null,
    parameters = {},
    containerId = null,
    applicationName = null,
    serviceName = null,
  }) {
    assertMetadataOnly(parameters, `recordEvent(${functionName})`);
    const probe = this.catalog.lookupFunction(functionName);
    const resolvedOp = cryptoOperation || (probe ? probe.crypto_operation : "cryptographic_call");

    const event = new RuntimeCryptoEvent({
      processId,
      processName,
      libraryName,
      functionName,
      cryptoOperation: resolvedOp,
      parameters,
      containerId,
      applicationName: applicationName || processName,
      serviceName,
    });
    this.events.push(event);
    return event;
  }

  correlateToDomainAssets(event) {
    const appName = event.applicationName || event.processName;
    const appRef = `app:${appName}`;
    const procRef = `proc:${event.processId}:${event.processName}`;
    const libRef = `lib:${event.libraryName.toLowerCase()}`;
    const fnRef = `fn:${event.libraryName.toLowerCase()}:${event.functionName}`;

    const algoName =
      event.parameters.cipher_name ||
      event.parameters.digest_name ||
      event.parameters.algorithm ||
      "unknown_algorithm";
    const keySize = event.parameters.key_length || event.parameters.key_size_bits || null;
    const assetId = keySize ? `runtime:asset:${algoName}-${keySize}` : `runtime:asset:${algoName}`;

    const relationships = [
      {
        source_id: appRef,
        target_id: procRef,
        relationship_type: "hosts_process",
        metadata: { container_id: event.containerId },
      },
      {
        source_id: procRef,
        target_id: libRef,
        relationship_type: RelationshipType.DEPENDS_ON,
        metadata: { library_name: event.libraryName },
      },
      {
        source_id: procRef,
        target_id: fnRef,
        relationship_type: RelationshipType.USES,
        metadata: { function_name: event.functionName, crypto_operation: event.cryptoOperation },
      },
      {
        source_id: fnRef,
        target_id: assetId,
        relationship_type: RelationshipType.IMPLEMENTS,
        metadata: {
          crypto_operation: event.cryptoOperation,
          parameters: event.parameters,
          reachability_level: "RUNTIME_CONFIRMED",
        },
      },
    ];

    return {
      application_ref: appRef,
      process_ref: procRef,
      library_ref: libRef,
      function_ref: fnRef,
      crypto_asset_id: assetId,
      algorithm_name: algoName,
      key_size: keySize,
      crypto_operation: event.cryptoOperation,
      reachability: "RUNTIME_CONFIRMED",
      evidence_source: EvidenceSource.RUNTIME,
      relationships,
    };
  }
}

module.exports = {
  RuntimeCapabilityStatus,
  SensitiveDataExposureError,
  RuntimeCryptoEvent,
  KernelCapabilityChecker,
  RuntimeProbesCatalog,
  RuntimeObservationSubsystem,
  assertMetadataOnly,
};
