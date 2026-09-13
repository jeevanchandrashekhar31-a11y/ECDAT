/**
 * ECDAT Certificate Intelligence & Inventory Engine (Node.js)
 * Phase 5.2 Certificate Intelligence
 *
 * Tracks:
 * - subject
 * - issuer
 * - SAN
 * - validity
 * - public-key algorithm
 * - public-key size
 * - signature algorithm
 * - chain
 * - trust context
 * - endpoint usage
 * - owner
 * - environment
 * - renewal state
 *
 * Detects:
 * - expired
 * - expiring
 * - weak keys
 * - deprecated signatures
 * - invalid chains
 * - inconsistent deployments
 *
 * STRICT INVARIANT: Never store private key material.
 */

const PRIVATE_KEY_MARKERS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----BEGIN RSA PRIVATE KEY-----",
  "-----BEGIN EC PRIVATE KEY-----",
  "-----BEGIN DSA PRIVATE KEY-----",
  "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  "-----BEGIN OPENSSH PRIVATE KEY-----",
];

const RenewalState = Object.freeze({
  OK: "OK",
  EXPIRING_SOON: "EXPIRING_SOON", // <= 30 days
  CRITICAL_EXPIRING: "CRITICAL_EXPIRING", // <= 7 days
  EXPIRED: "EXPIRED",
  NOT_YET_VALID: "NOT_YET_VALID",
  RENEWED: "RENEWED",
});

const TrustStatus = Object.freeze({
  TRUSTED: "trusted",
  SELF_SIGNED: "self_signed",
  UNTRUSTED_ROOT: "untrusted_root",
  INVALID_CHAIN: "invalid_chain",
  UNKNOWN: "unknown",
});

/**
 * Strict security guard ensuring zero private key material is accepted or stored.
 * @param {any} content
 */
function assertNoPrivateKey(content) {
  if (!content) return;
  const str = typeof content === "object" ? JSON.stringify(content) : String(content);
  for (const marker of PRIVATE_KEY_MARKERS) {
    if (str.includes(marker)) {
      throw new Error(
        "SECURITY VIOLATION: Private key material detected! ECDAT Certificate Inventory strictly forbids storing or processing private keys."
      );
    }
  }
}

class CertificateInventory {
  constructor(options = {}) {
    this.warningDays = options.warningDays || 30;
    this.criticalDays = options.criticalDays || 7;
    /** @type {Map<string, object>} */
    this.inventory = new Map();
  }

  /**
   * Add or update a certificate in the inventory.
   * @param {object} certData
   * @param {object} [options]
   * @returns {object}
   */
  addOrUpdateCertificate(certData, options = {}) {
    assertNoPrivateKey(certData);
    assertNoPrivateKey(options);

    const fp = (
      certData.fingerprint_sha256 ||
      certData.fingerprint ||
      certData.subjectName ||
      "unknown-cert"
    ).toLowerCase();

    const now = new Date();
    const notBeforeStr = certData.notValidBefore || certData.not_before || "";
    const notAfterStr = certData.notValidAfter || certData.not_after || "";

    let daysUntilExp = 0;
    let isExpired = false;
    let isNotYetValid = false;

    if (notAfterStr) {
      const dtAfter = new Date(notAfterStr);
      if (!isNaN(dtAfter.getTime())) {
        const diffMs = dtAfter.getTime() - now.getTime();
        daysUntilExp = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (now > dtAfter) {
          isExpired = true;
        }
      }
    }

    if (notBeforeStr) {
      const dtBefore = new Date(notBeforeStr);
      if (!isNaN(dtBefore.getTime()) && now < dtBefore) {
        isNotYetValid = true;
      }
    }

    let renewalState = RenewalState.OK;
    if (isExpired) {
      renewalState = RenewalState.EXPIRED;
    } else if (isNotYetValid) {
      renewalState = RenewalState.NOT_YET_VALID;
    } else if (daysUntilExp <= this.criticalDays) {
      renewalState = RenewalState.CRITICAL_EXPIRING;
    } else if (daysUntilExp <= this.warningDays) {
      renewalState = RenewalState.EXPIRING_SOON;
    }

    const chain = options.chain || certData.chain || [certData];
    const isSelfSigned =
      certData.isSelfSigned !== undefined
        ? Boolean(certData.isSelfSigned)
        : certData.subjectName === certData.issuerName && Boolean(certData.subjectName);

    let trustStatus = TrustStatus.TRUSTED;
    if (isSelfSigned) {
      trustStatus = TrustStatus.SELF_SIGNED;
    } else if (chain.length === 1) {
      trustStatus = TrustStatus.UNTRUSTED_ROOT;
    }

    const existing = this.inventory.get(fp);
    const endpoints = existing ? [...existing.endpoint_usage] : [];

    if (options.endpoint) {
      const epKey =
        options.endpoint.endpoint || `${options.endpoint.host}:${options.endpoint.port}`;
      const foundIdx = endpoints.findIndex((e) => e.endpoint === epKey);
      if (foundIdx >= 0) {
        endpoints[foundIdx].last_seen = now.toISOString();
      } else {
        endpoints.push({
          endpoint: epKey,
          host: options.endpoint.host || "",
          port: options.endpoint.port || 443,
          protocol: options.endpoint.protocol || "TLS",
          first_seen: now.toISOString(),
          last_seen: now.toISOString(),
          sni: options.endpoint.sni || null,
        });
      }
    }

    const item = {
      fingerprint_sha256: fp,
      serial_number: String(certData.serial_number || certData.serialNumber || ""),
      subject: certData.subjectName || certData.subject || "CN=unknown",
      issuer: certData.issuerName || certData.issuer || "CN=unknown",
      san: certData.sans || certData.san || [],
      not_before: notBeforeStr,
      not_after: notAfterStr,
      days_until_expiration: daysUntilExp,
      public_key_algorithm: certData.algo_family || certData.public_key_algorithm || "RSA",
      public_key_size: certData.key_size || certData.public_key_size || 2048,
      signature_algorithm: certData.signature_algorithm || "sha256WithRSAEncryption",
      chain: chain,
      chain_fingerprints: chain.map(
        (c) => (c.fingerprint_sha256 || c.fingerprint || c.subjectName || "").toLowerCase()
      ),
      trust_context: {
        trust_status: trustStatus,
        is_self_signed: isSelfSigned,
        chain_depth: chain.length,
        is_complete_chain: chain.length > 1 || isSelfSigned,
      },
      endpoint_usage: endpoints,
      owner: options.owner || (existing ? existing.owner : "unassigned"),
      environment: options.environment || (existing ? existing.environment : "production"),
      renewal_state: renewalState,
      detected_anomalies: [],
      created_at: existing ? existing.created_at : now.toISOString(),
      updated_at: now.toISOString(),
    };

    assertNoPrivateKey(item);
    this._detectItemAnomalies(item);
    this.inventory.set(fp, item);
    return item;
  }

  /**
   * Internal anomaly detection on a single certificate item.
   * @param {object} item
   */
  _detectItemAnomalies(item) {
    const anomalies = new Set();

    // 1. Expired
    if (item.renewal_state === RenewalState.EXPIRED || item.days_until_expiration < 0) {
      anomalies.add("expired");
    }

    // 2. Expiring
    if (
      item.renewal_state === RenewalState.EXPIRING_SOON ||
      item.renewal_state === RenewalState.CRITICAL_EXPIRING
    ) {
      anomalies.add("expiring");
    }

    // 3. Weak keys
    const algo = String(item.public_key_algorithm).toUpperCase();
    const size = item.public_key_size;
    if (algo === "RSA" && size && size < 2048) {
      anomalies.add("weak_keys");
    } else if ((algo === "EC" || algo === "ECDSA") && size && size < 224) {
      anomalies.add("weak_keys");
    } else if (algo === "DSA" && size && size < 2048) {
      anomalies.add("weak_keys");
    }

    // 4. Deprecated signatures
    const sig = String(item.signature_algorithm).toLowerCase();
    if (sig.includes("md5") || sig.includes("sha1")) {
      anomalies.add("deprecated_signatures");
    }

    // 5. Invalid chains
    if (item.chain && item.chain.length > 1) {
      for (let i = 0; i < item.chain.length - 1; i++) {
        const child = item.chain[i];
        const parent = item.chain[i + 1];
        const cIssuer = child.issuerName || child.issuer;
        const pSubject = parent.subjectName || parent.subject;
        if (cIssuer && pSubject && cIssuer !== pSubject) {
          anomalies.add("invalid_chains");
          break;
        }
      }
    } else if (!item.trust_context.is_self_signed) {
      anomalies.add("invalid_chains");
    }

    item.detected_anomalies = Array.from(anomalies).sort();
  }

  /**
   * Detects global inconsistent deployments across all certificates in the inventory.
   * @returns {Record<string, string[]>}
   */
  detectInconsistentDeployments() {
    const inconsistencies = {};

    // 1. Map hostnames to certificates
    const hostToCerts = new Map();
    for (const item of this.inventory.values()) {
      for (const ep of item.endpoint_usage) {
        const host = String(ep.host || "").toLowerCase();
        if (host) {
          if (!hostToCerts.has(host)) hostToCerts.set(host, []);
          hostToCerts.get(host).push(item);
        }
      }
    }

    for (const [host, certList] of hostToCerts.entries()) {
      const uniqueFps = Array.from(new Set(certList.map((c) => c.fingerprint_sha256)));
      if (uniqueFps.length > 1) {
        for (const c of certList) {
          const msg = `inconsistent_deployments:multiple_certificates_for_host:${host}`;
          if (!c.detected_anomalies.includes(msg)) {
            c.detected_anomalies.push(msg);
          }
          if (!inconsistencies[c.fingerprint_sha256]) inconsistencies[c.fingerprint_sha256] = [];
          inconsistencies[c.fingerprint_sha256].push(msg);
        }
      }
    }

    // 2. Hostname mismatch & production self-signed check
    for (const item of this.inventory.values()) {
      const certNames = [item.subject.toLowerCase(), ...item.san.map((s) => s.toLowerCase())];
      for (const ep of item.endpoint_usage) {
        const h = String(ep.host || "").toLowerCase();
        if (h && !certNames.some((n) => n === h || n.includes(h) || (n.startsWith("*.") && h.endsWith(n.slice(2))))) {
          const msg = `inconsistent_deployments:hostname_mismatch:${h}`;
          if (!item.detected_anomalies.includes(msg)) {
            item.detected_anomalies.push(msg);
          }
          if (!inconsistencies[item.fingerprint_sha256]) inconsistencies[item.fingerprint_sha256] = [];
          inconsistencies[item.fingerprint_sha256].push(msg);
        }
      }

      if (item.environment === "production" && item.trust_context.is_self_signed) {
        const msg = "inconsistent_deployments:production_self_signed";
        if (!item.detected_anomalies.includes(msg)) {
          item.detected_anomalies.push(msg);
        }
        if (!inconsistencies[item.fingerprint_sha256]) inconsistencies[item.fingerprint_sha256] = [];
        inconsistencies[item.fingerprint_sha256].push(msg);
      }
    }

    // Detect renewed superseded certificates
    for (const item of this.inventory.values()) {
      if (item.renewal_state === RenewalState.EXPIRED) {
        for (const other of this.inventory.values()) {
          if (
            other.fingerprint_sha256 !== item.fingerprint_sha256 &&
            other.subject === item.subject &&
            (other.renewal_state === RenewalState.OK ||
              other.renewal_state === RenewalState.EXPIRING_SOON)
          ) {
            item.renewal_state = RenewalState.RENEWED;
            break;
          }
        }
      }
    }

    return inconsistencies;
  }

  get(fingerprint) {
    return this.inventory.get(String(fingerprint).toLowerCase()) || null;
  }

  list(filters = {}) {
    this.detectInconsistentDeployments();
    let items = Array.from(this.inventory.values());

    if (filters.environment) {
      items = items.filter((i) => i.environment === filters.environment);
    }
    if (filters.renewalState) {
      items = items.filter((i) => i.renewal_state === filters.renewalState);
    }
    if (filters.owner) {
      items = items.filter((i) => i.owner === filters.owner);
    }
    if (filters.anomaly) {
      items = items.filter((i) =>
        i.detected_anomalies.some((a) => a.startsWith(filters.anomaly))
      );
    }
    if (filters.expiringWithinDays !== undefined) {
      const days = parseInt(filters.expiringWithinDays, 10);
      items = items.filter((i) => i.days_until_expiration >= 0 && i.days_until_expiration <= days);
    }

    return items;
  }

  getSummary() {
    this.detectInconsistentDeployments();
    const summary = {
      total_certificates: this.inventory.size,
      renewal_states: {
        [RenewalState.OK]: 0,
        [RenewalState.EXPIRING_SOON]: 0,
        [RenewalState.CRITICAL_EXPIRING]: 0,
        [RenewalState.EXPIRED]: 0,
        [RenewalState.NOT_YET_VALID]: 0,
        [RenewalState.RENEWED]: 0,
      },
      anomalies: {
        expired: 0,
        expiring: 0,
        weak_keys: 0,
        deprecated_signatures: 0,
        invalid_chains: 0,
        inconsistent_deployments: 0,
      },
      environments: {},
    };

    for (const item of this.inventory.values()) {
      summary.renewal_states[item.renewal_state] =
        (summary.renewal_states[item.renewal_state] || 0) + 1;
      summary.environments[item.environment] =
        (summary.environments[item.environment] || 0) + 1;

      for (const a of item.detected_anomalies) {
        const prefix = a.split(":")[0];
        if (summary.anomalies[prefix] !== undefined) {
          summary.anomalies[prefix] += 1;
        }
      }
    }

    return summary;
  }
}

// Global default singleton instance
const globalCertInventory = new CertificateInventory();

module.exports = {
  CertificateInventory,
  globalCertInventory,
  RenewalState,
  TrustStatus,
  assertNoPrivateKey,
};
