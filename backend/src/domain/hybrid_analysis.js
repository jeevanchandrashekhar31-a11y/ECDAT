/**
 * ECDAT TLS / PQC / Hybrid Handshake Analysis Domain Model (Node.js) - Phase 5.3
 *
 * Core Guarantees:
 * 1. Explicitly models classical, PQC, and hybrid handshake properties.
 * 2. Invariant: PCAP (passive packet capture) CANNOT reveal plaintext without ephemeral keys.
 * 3. Evidence source differentiation: STATIC_CONFIGURATION, NETWORK_HANDSHAKE, RUNTIME.
 * 4. First-class relationships for hybrid components.
 * 5. Dynamic loading of versioned PQC catalog rules without hardcoded algorithm rewrites.
 */

const fs = require("fs");
const path = require("path");
const { EvidenceSource, RelationshipType } = require("./contracts");

const HandshakeCategory = Object.freeze({
  CLASSICAL: "classical",
  HYBRID: "hybrid",
  POST_QUANTUM: "post_quantum",
});

const PCAP_PLAINTEXT_DISCLAIMER = Object.freeze(
  "Cryptographic Invariant: Passive packet capture alone CANNOT reveal application plaintext " +
  "for sessions utilizing forward-secret (PFS) or hybrid ephemeral key exchange. " +
  "Compromise of the long-term private signing/identity key does not permit retroactive " +
  "decryption of ephemeral sessions without per-session ephemeral pre-master secret logs (SSLKEYLOGFILE)."
);

class PlaintextExposureError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlaintextExposureError";
  }
}

class TlsHandshakeProperties {
  constructor(data = {}) {
    this.endpoint = data.endpoint || "";
    this.tlsVersion = data.tlsVersion || "";
    this.cipherSuite = data.cipherSuite || "";
    this.keyExchangeGroup = data.keyExchangeGroup || null;
    this.signatureAlgorithm = data.signatureAlgorithm || null;
    this.category = data.category || HandshakeCategory.CLASSICAL;
    this.evidenceSource = data.evidenceSource || EvidenceSource.NETWORK_HANDSHAKE;
    this.catalogAlgorithmId = data.catalogAlgorithmId || null;
    this.standardName = data.standardName || null;
    this.standardReference = data.standardReference || null;
    this.ianaGroupId = data.ianaGroupId || null;
    this.nistQuantumLevel = data.nistQuantumLevel !== undefined ? data.nistQuantumLevel : null;
    this.harvestNowDecryptLaterResilient = Boolean(data.harvestNowDecryptLaterResilient);
    this.quantumAuthenticationResilient = Boolean(data.quantumAuthenticationResilient);
    this.ephemeralForwardSecrecy = data.ephemeralForwardSecrecy !== undefined ? Boolean(data.ephemeralForwardSecrecy) : true;
    
    // Core Invariant: Packet capture cannot reveal plaintext
    this.packetCaptureCanRevealPlaintext = Boolean(data.packetCaptureCanRevealPlaintext);
    if (this.packetCaptureCanRevealPlaintext) {
      throw new PlaintextExposureError(
        `False plaintext exposure claim detected for endpoint ${this.endpoint}: ` +
        `Passive packet capture cannot expose plaintext for ${this.cipherSuite} / ${this.keyExchangeGroup}.`
      );
    }
    this.pcapPlaintextDisclaimer = PCAP_PLAINTEXT_DISCLAIMER;
    this.relationships = Array.isArray(data.relationships) ? data.relationships : [];
    Object.freeze(this);
  }

  toJSON() {
    return {
      endpoint: this.endpoint,
      tls_version: this.tlsVersion,
      cipher_suite: this.cipherSuite,
      key_exchange_group: this.keyExchangeGroup,
      signature_algorithm: this.signatureAlgorithm,
      category: this.category,
      evidence_source: this.evidenceSource,
      catalog_algorithm_id: this.catalogAlgorithmId,
      standard_name: this.standardName,
      standard_reference: this.standardReference,
      iana_group_id: this.ianaGroupId,
      nist_quantum_level: this.nistQuantumLevel,
      harvest_now_decrypt_later_resilient: this.harvestNowDecryptLaterResilient,
      quantum_authentication_resilient: this.quantumAuthenticationResilient,
      ephemeral_forward_secrecy: this.ephemeralForwardSecrecy,
      packet_capture_can_reveal_plaintext: this.packetCaptureCanRevealPlaintext,
      pcap_plaintext_disclaimer: this.pcapPlaintextDisclaimer,
      relationships: this.relationships,
    };
  }
}

class PqcCatalogLoader {
  constructor(customPath = null) {
    this.catalogPath = customPath || path.resolve(__dirname, "../../../rules/pqc_algorithm_catalog.json");
    this.version = "0.0.0";
    this.lastUpdated = "";
    this.algorithms = new Map();
    this.aliasMap = new Map();
    this.groupMap = new Map();
    this.loadCatalog();
  }

  loadCatalog() {
    if (!fs.existsSync(this.catalogPath)) {
      throw new Error(`PQC algorithm catalog not found at ${this.catalogPath}`);
    }
    const raw = fs.readFileSync(this.catalogPath, "utf-8");
    const data = JSON.parse(raw);
    this.version = data.catalog_version || "1.0.0";
    this.lastUpdated = data.last_updated || "";
    this.algorithms.clear();
    this.aliasMap.clear();
    this.groupMap.clear();

    for (const algo of data.algorithms || []) {
      const id = algo.id;
      this.algorithms.set(id, algo);
      this.aliasMap.set(id.toLowerCase(), id);
      if (algo.standard_name) {
        this.aliasMap.set(algo.standard_name.toLowerCase(), id);
      }
      for (const alias of algo.aliases || []) {
        this.aliasMap.set(alias.toLowerCase(), id);
      }
      if (algo.ssh_name) {
        this.aliasMap.set(algo.ssh_name.toLowerCase(), id);
      }
      if (algo.iana_tls_group_id !== null && algo.iana_tls_group_id !== undefined) {
        this.groupMap.set(Number(algo.iana_tls_group_id), id);
      }
    }
  }

  lookup(nameOrAlias) {
    if (!nameOrAlias || typeof nameOrAlias !== "string") return null;
    const clean = nameOrAlias.trim().toLowerCase();
    const id = this.aliasMap.get(clean);
    return id ? this.algorithms.get(id) || null : null;
  }

  lookupGroup(groupId) {
    if (groupId === null || groupId === undefined) return null;
    const id = this.groupMap.get(Number(groupId));
    return id ? this.algorithms.get(id) || null : null;
  }
}

class HybridAnalysisEngine {
  constructor(catalog = null) {
    this.catalog = catalog || new PqcCatalogLoader();
  }

  analyze({
    endpoint = "unknown-endpoint",
    tlsVersion = "TLSv1.3",
    cipherSuite = "",
    keyExchangeGroup = null,
    signatureAlgorithm = null,
    evidenceSource = EvidenceSource.NETWORK_HANDSHAKE,
    packetCaptureCanRevealPlaintext = false,
  }) {
    // 1. Guard against false plaintext exposure claims
    if (packetCaptureCanRevealPlaintext) {
      throw new PlaintextExposureError(
        `Security assertion failed: Packet capture cannot reveal plaintext for ${endpoint}.`
      );
    }

    // 2. Resolve key exchange algorithm from catalog
    let kexAlgo = null;
    if (keyExchangeGroup) {
      kexAlgo = this.catalog.lookup(keyExchangeGroup);
    }
    if (!kexAlgo && cipherSuite) {
      kexAlgo = this.catalog.lookup(cipherSuite);
    }

    // 3. Classify category
    let category = HandshakeCategory.CLASSICAL;
    if (kexAlgo) {
      if (kexAlgo.category === "hybrid") category = HandshakeCategory.HYBRID;
      else if (kexAlgo.category === "post_quantum") category = HandshakeCategory.POST_QUANTUM;
      else category = HandshakeCategory.CLASSICAL;
    } else {
      const combined = `${keyExchangeGroup || ""} ${cipherSuite}`.toLowerCase();
      if (/mlkem|kyber|sntrup761|frodo|bikel/.test(combined)) {
        if (/x25519|p256|p384|secp256r1|rsa/.test(combined)) {
          category = HandshakeCategory.HYBRID;
        } else {
          category = HandshakeCategory.POST_QUANTUM;
        }
      }
    }

    // 4. Forward secrecy check
    let forwardSecrecy = true;
    const cUpper = cipherSuite.toUpperCase();
    if (
      cUpper.startsWith("TLS_RSA_") ||
      cUpper.startsWith("RSA_") ||
      (cUpper.includes("-SHA") && !/(ECDHE|DHE|ECDH|DH)/.test(cUpper))
    ) {
      forwardSecrecy = false;
    }

    // 5. Build first-class relationships
    const relationships = this._buildRelationships({
      endpoint,
      kexAlgo,
      signatureAlgorithm,
    });

    // 6. Build properties
    const props = new TlsHandshakeProperties({
      endpoint,
      tlsVersion,
      cipherSuite,
      keyExchangeGroup,
      signatureAlgorithm,
      category,
      evidenceSource,
      catalogAlgorithmId: kexAlgo ? kexAlgo.id : null,
      standardName: kexAlgo ? kexAlgo.standard_name : null,
      standardReference: kexAlgo ? kexAlgo.standard_reference : null,
      ianaGroupId: kexAlgo ? kexAlgo.iana_tls_group_id : null,
      nistQuantumLevel: kexAlgo ? kexAlgo.nist_quantum_security_level : null,
      harvestNowDecryptLaterResilient: kexAlgo ? Boolean(kexAlgo.harvest_now_decrypt_later_resilient) : false,
      quantumAuthenticationResilient: false,
      ephemeralForwardSecrecy: forwardSecrecy,
      packetCaptureCanRevealPlaintext: false,
      relationships,
    });

    if (signatureAlgorithm) {
      const sigMeta = this.catalog.lookup(signatureAlgorithm);
      if (sigMeta && (sigMeta.category === "post_quantum" || sigMeta.category === "hybrid")) {
        // Return updated properties with quantumAuthenticationResilient
        return new TlsHandshakeProperties({
          ...props,
          quantumAuthenticationResilient: true,
        });
      }
    }

    return props;
  }

  _buildRelationships({ endpoint, kexAlgo, signatureAlgorithm }) {
    const relationships = [];
    if (!kexAlgo) return relationships;

    const kexId = kexAlgo.id;
    // Endpoint -> Negotiated Key Exchange
    relationships.push({
      source_id: `endpoint:${endpoint}`,
      target_id: `algo:${kexId}`,
      relationship_type: RelationshipType.NEGOTIATED_KEY_EXCHANGE,
      properties: {
        standard_name: kexAlgo.standard_name,
        category: kexAlgo.category,
      },
    });

    // If Hybrid, decompose into first-class components
    if (kexAlgo.category === "hybrid" && kexAlgo.hybrid_components) {
      const comp = kexAlgo.hybrid_components;
      if (comp.classical_component) {
        const classicalMeta = this.catalog.lookup(comp.classical_component) || {};
        relationships.push({
          source_id: `algo:${kexId}`,
          target_id: `algo:${comp.classical_component}`,
          relationship_type: RelationshipType.HAS_CLASSICAL_COMPONENT,
          properties: {
            role: "classical_pre_master_secret",
            standard_name: classicalMeta.standard_name || comp.classical_component,
            quantum_resilient: false,
          },
        });
      }
      if (comp.post_quantum_component) {
        const pqcMeta = this.catalog.lookup(comp.post_quantum_component) || {};
        relationships.push({
          source_id: `algo:${kexId}`,
          target_id: `algo:${comp.post_quantum_component}`,
          relationship_type: RelationshipType.HAS_POST_QUANTUM_COMPONENT,
          properties: {
            role: "post_quantum_pre_master_secret",
            standard_name: pqcMeta.standard_name || comp.post_quantum_component,
            nist_level: pqcMeta.nist_quantum_security_level || 3,
            quantum_resilient: true,
          },
        });
      }
      if (comp.combiner_function) {
        relationships.push({
          source_id: `algo:${kexId}`,
          target_id: `kdf:${comp.combiner_function}`,
          relationship_type: RelationshipType.USES_HYBRID_COMBINER,
          properties: {
            function: comp.combiner_function,
            combining_strategy: "concatenation_kdf_extract_and_expand",
          },
        });
      }
    }

    if (signatureAlgorithm) {
      const sigMeta = this.catalog.lookup(signatureAlgorithm) || {};
      relationships.push({
        source_id: `endpoint:${endpoint}`,
        target_id: `sig:${signatureAlgorithm}`,
        relationship_type: RelationshipType.AUTHENTICATED_BY_SIGNATURE,
        properties: {
          standard_name: sigMeta.standard_name || signatureAlgorithm,
          category: sigMeta.category || "classical",
        },
      });
    }

    return relationships;
  }
}

function assertNoPcapPlaintextClaim(finding) {
  if (!finding) return;
  const findingStr = JSON.stringify(finding).toLowerCase();
  const forbidden = [
    "packet capture reveals plaintext",
    "pcap reveals plaintext",
    "pcap decrypts traffic",
    "plaintext exposed in packet capture",
    "packet capture can reveal plaintext",
  ];
  for (const phrase of forbidden) {
    if (findingStr.includes(phrase)) {
      throw new PlaintextExposureError(
        `Cryptographic error in scan finding: Illegal claim '${phrase}'. ` +
        "Packet capture alone cannot reveal plaintext."
      );
    }
  }
  if (finding.packet_capture_can_reveal_plaintext === true || finding.packetCaptureCanRevealPlaintext === true) {
    throw new PlaintextExposureError(
      "Cryptographic error: packet_capture_can_reveal_plaintext is asserted as true."
    );
  }
}

module.exports = {
  HandshakeCategory,
  PCAP_PLAINTEXT_DISCLAIMER,
  PlaintextExposureError,
  TlsHandshakeProperties,
  PqcCatalogLoader,
  HybridAnalysisEngine,
  assertNoPcapPlaintextClaim,
};
