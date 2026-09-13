const test = require("node:test");
const assert = require("node:assert/strict");

const {
  HandshakeCategory,
  PCAP_PLAINTEXT_DISCLAIMER,
  PlaintextExposureError,
  TlsHandshakeProperties,
  PqcCatalogLoader,
  HybridAnalysisEngine,
  assertNoPcapPlaintextClaim,
} = require("../../src/domain/hybrid_analysis");

const { EvidenceSource, RelationshipType } = require("../../src/domain/contracts");

test("PQC Catalog Loader - loads version and parses standard hybrid groups", () => {
  const catalog = new PqcCatalogLoader();
  assert.equal(catalog.version, "2.0.0");
  assert.ok(catalog.algorithms.size >= 15);

  const x25519Mlkem = catalog.lookup("x25519_mlkem768");
  assert.ok(x25519Mlkem);
  assert.equal(x25519Mlkem.standard_name, "X25519MLKEM768");
  assert.equal(x25519Mlkem.iana_tls_group_id, 4588);
  assert.equal(x25519Mlkem.nist_quantum_security_level, 3);

  // Lookup by IANA numeric group id
  const byGroup = catalog.lookupGroup(4588);
  assert.deepEqual(byGroup, x25519Mlkem);

  // Lookup SSH hybrid
  const sshKex = catalog.lookup("sntrup761x25519-sha512@openssh.com");
  assert.ok(sshKex);
  assert.equal(sshKex.category, "hybrid");
});

test("Hybrid Analysis Engine - explicitly models classical handshake", () => {
  const engine = new HybridAnalysisEngine();
  const props = engine.analyze({
    endpoint: "legacy.service.com:443",
    tlsVersion: "TLSv1.2",
    cipherSuite: "ECDHE-RSA-AES128-GCM-SHA256",
    keyExchangeGroup: "secp256r1",
    signatureAlgorithm: "rsa",
    evidenceSource: EvidenceSource.NETWORK_HANDSHAKE,
  });

  assert.equal(props.category, HandshakeCategory.CLASSICAL);
  assert.equal(props.evidenceSource, EvidenceSource.NETWORK_HANDSHAKE);
  assert.equal(props.harvestNowDecryptLaterResilient, false);
  assert.equal(props.quantumAuthenticationResilient, false);
  assert.equal(props.packetCaptureCanRevealPlaintext, false);
  assert.ok(props.pcapPlaintextDisclaimer.includes("Passive packet capture alone CANNOT reveal"));
});

test("Hybrid Analysis Engine - models standardized PQC hybrid handshake and first-class relationships", () => {
  const engine = new HybridAnalysisEngine();
  const props = engine.analyze({
    endpoint: "pqc.corp.internal:443",
    tlsVersion: "TLSv1.3",
    cipherSuite: "TLS_AES_256_GCM_SHA384",
    keyExchangeGroup: "X25519MLKEM768",
    signatureAlgorithm: "rsa_pss_rsae_sha256",
    evidenceSource: EvidenceSource.NETWORK_HANDSHAKE,
  });

  assert.equal(props.category, HandshakeCategory.HYBRID);
  assert.equal(props.catalogAlgorithmId, "x25519_mlkem768");
  assert.equal(props.standardName, "X25519MLKEM768");
  assert.equal(props.ianaGroupId, 4588);
  assert.equal(props.nistQuantumLevel, 3);
  assert.equal(props.harvestNowDecryptLaterResilient, true);
  assert.equal(props.quantumAuthenticationResilient, false); // Classical cert
  assert.equal(props.packetCaptureCanRevealPlaintext, false);

  // Check first-class relationships
  const relTypes = props.relationships.map((r) => r.relationship_type);
  assert.ok(relTypes.includes(RelationshipType.NEGOTIATED_KEY_EXCHANGE));
  assert.ok(relTypes.includes(RelationshipType.HAS_CLASSICAL_COMPONENT));
  assert.ok(relTypes.includes(RelationshipType.HAS_POST_QUANTUM_COMPONENT));
  assert.ok(relTypes.includes(RelationshipType.USES_HYBRID_COMBINER));

  const pqcComp = props.relationships.find((r) => r.relationship_type === RelationshipType.HAS_POST_QUANTUM_COMPONENT);
  assert.equal(pqcComp.target_id, "algo:ml_kem_768");
  assert.equal(pqcComp.properties.quantum_resilient, true);

  const classicalComp = props.relationships.find((r) => r.relationship_type === RelationshipType.HAS_CLASSICAL_COMPONENT);
  assert.equal(classicalComp.target_id, "algo:x25519");
  assert.equal(classicalComp.properties.quantum_resilient, false);
});

test("Hybrid Analysis Engine - models pure PQC with quantum authentication", () => {
  const engine = new HybridAnalysisEngine();
  const props = engine.analyze({
    endpoint: "pqc-pure.gov:443",
    tlsVersion: "TLSv1.3",
    cipherSuite: "TLS_AES_256_GCM_SHA384",
    keyExchangeGroup: "ML-KEM-1024",
    signatureAlgorithm: "ML-DSA-87",
    evidenceSource: EvidenceSource.RUNTIME,
  });

  assert.equal(props.category, HandshakeCategory.POST_QUANTUM);
  assert.equal(props.evidenceSource, EvidenceSource.RUNTIME);
  assert.equal(props.harvestNowDecryptLaterResilient, true);
  assert.equal(props.quantumAuthenticationResilient, true);
  assert.equal(props.nistQuantumLevel, 5);
});

test("Evidence Source Differentiation - distinguishes STATIC, NETWORK, and RUNTIME", () => {
  const engine = new HybridAnalysisEngine();

  const staticEv = engine.analyze({
    endpoint: "config:/etc/nginx/nginx.conf",
    tlsVersion: "TLSv1.3",
    cipherSuite: "TLS_AES_128_GCM_SHA256",
    evidenceSource: EvidenceSource.STATIC_CONFIGURATION,
  });
  assert.equal(staticEv.evidenceSource, EvidenceSource.STATIC_CONFIGURATION);

  const netEv = engine.analyze({
    endpoint: "10.0.0.1:443",
    tlsVersion: "TLSv1.3",
    cipherSuite: "TLS_AES_128_GCM_SHA256",
    evidenceSource: EvidenceSource.NETWORK_HANDSHAKE,
  });
  assert.equal(netEv.evidenceSource, EvidenceSource.NETWORK_HANDSHAKE);

  const runtimeEv = engine.analyze({
    endpoint: "process:pid-5412",
    tlsVersion: "TLSv1.3",
    cipherSuite: "TLS_AES_128_GCM_SHA256",
    evidenceSource: EvidenceSource.RUNTIME,
  });
  assert.equal(runtimeEv.evidenceSource, EvidenceSource.RUNTIME);
});

test("Packet Capture Plaintext Invariant - forbids false exposure claims", () => {
  const engine = new HybridAnalysisEngine();

  // Attempting to claim packet capture reveals plaintext in analyze options throws PlaintextExposureError
  assert.throws(
    () => {
      engine.analyze({
        endpoint: "bad.actor:443",
        packetCaptureCanRevealPlaintext: true,
      });
    },
    {
      name: "PlaintextExposureError",
      message: /Packet capture cannot reveal plaintext/,
    }
  );

  // Instantiating TlsHandshakeProperties with packetCaptureCanRevealPlaintext = true throws PlaintextExposureError
  assert.throws(
    () => {
      new TlsHandshakeProperties({
        endpoint: "bad.actor:443",
        packetCaptureCanRevealPlaintext: true,
      });
    },
    {
      name: "PlaintextExposureError",
      message: /False plaintext exposure claim detected/,
    }
  );

  // Guard function assertNoPcapPlaintextClaim rejects illegal claims
  const invalidFinding = {
    findingId: "F-1",
    description: "Session packet capture reveals plaintext payload to passive eavesdropper",
  };
  assert.throws(
    () => {
      assertNoPcapPlaintextClaim(invalidFinding);
    },
    {
      name: "PlaintextExposureError",
      message: /Illegal claim 'packet capture reveals plaintext'/,
    }
  );

  // Valid finding passes guard
  assert.doesNotThrow(() => {
    assertNoPcapPlaintextClaim({
      findingId: "F-2",
      packetCaptureCanRevealPlaintext: false,
      description: "Passive packet capture observed encrypted TLS 1.3 records.",
    });
  });
});
