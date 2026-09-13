const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const {
  CertificateInventory,
  RenewalState,
  TrustStatus,
  assertNoPrivateKey,
} = require("../../src/domain/certificate_inventory");

describe("Certificate Intelligence & Inventory Engine (Phase 5.2)", () => {
  test("Tracks all required certificate fields and relationships", () => {
    const inv = new CertificateInventory();

    const certData = {
      fingerprint_sha256: "leaf_fp_101",
      serial_number: "777888999",
      subjectName: "CN=api.payments.corp,O=Payments Org,C=US",
      issuerName: "CN=Payments Intermediate CA,O=Payments Org,C=US",
      sans: ["api.payments.corp", "checkout.payments.corp"],
      notValidBefore: "2026-01-01T00:00:00Z",
      notValidAfter: "2027-01-01T00:00:00Z",
      algo_family: "RSA",
      key_size: 2048,
      signature_algorithm: "sha256WithRSAEncryption",
    };

    const chain = [
      certData,
      {
        fingerprint_sha256: "inter_fp_102",
        subjectName: "CN=Payments Intermediate CA,O=Payments Org,C=US",
        issuerName: "CN=Root CA,O=Payments Org,C=US",
      },
      {
        fingerprint_sha256: "root_fp_103",
        subjectName: "CN=Root CA,O=Payments Org,C=US",
        issuerName: "CN=Root CA,O=Payments Org,C=US",
        isSelfSigned: true,
      },
    ];

    const endpoint = {
      endpoint: "api.payments.corp:443",
      host: "api.payments.corp",
      port: 443,
      protocol: "TLS",
    };

    const item = inv.addOrUpdateCertificate(certData, {
      chain,
      endpoint,
      owner: "fintech-ops@corp.internal",
      environment: "production",
    });

    // Verification of all tracked attributes
    assert.equal(item.fingerprint_sha256, "leaf_fp_101");
    assert.equal(item.serial_number, "777888999");
    assert.equal(item.subject, "CN=api.payments.corp,O=Payments Org,C=US");
    assert.equal(item.issuer, "CN=Payments Intermediate CA,O=Payments Org,C=US");
    assert.deepEqual(item.san, ["api.payments.corp", "checkout.payments.corp"]);
    assert.equal(item.not_before, "2026-01-01T00:00:00Z");
    assert.equal(item.not_after, "2027-01-01T00:00:00Z");
    assert.equal(item.public_key_algorithm, "RSA");
    assert.equal(item.public_key_size, 2048);
    assert.equal(item.signature_algorithm, "sha256WithRSAEncryption");
    assert.equal(item.chain.length, 3);
    assert.deepEqual(item.chain_fingerprints, ["leaf_fp_101", "inter_fp_102", "root_fp_103"]);
    assert.equal(item.trust_context.trust_status, TrustStatus.TRUSTED);
    assert.equal(item.endpoint_usage.length, 1);
    assert.equal(item.endpoint_usage[0].endpoint, "api.payments.corp:443");
    assert.equal(item.owner, "fintech-ops@corp.internal");
    assert.equal(item.environment, "production");
    assert.equal(item.renewal_state, RenewalState.OK);
  });

  test("Detects expired and expiring certificates", () => {
    const inv = new CertificateInventory({ warningDays: 30, criticalDays: 7 });
    const now = new Date();

    // 1. Expired certificate
    const pastDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const certExpired = {
      fingerprint: "expired_001",
      subjectName: "CN=expired.example.com",
      notValidAfter: pastDate,
    };
    const itemExpired = inv.addOrUpdateCertificate(certExpired);
    assert.equal(itemExpired.renewal_state, RenewalState.EXPIRED);
    assert.ok(itemExpired.detected_anomalies.includes("expired"));

    // 2. Critically expiring certificate (3 days left)
    const critDate = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const certCrit = {
      fingerprint: "crit_002",
      subjectName: "CN=crit.example.com",
      notValidAfter: critDate,
    };
    const itemCrit = inv.addOrUpdateCertificate(certCrit);
    assert.equal(itemCrit.renewal_state, RenewalState.CRITICAL_EXPIRING);
    assert.ok(itemCrit.detected_anomalies.includes("expiring"));

    // 3. Expiring soon certificate (20 days left)
    const warnDate = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const certWarn = {
      fingerprint: "warn_003",
      subjectName: "CN=warn.example.com",
      notValidAfter: warnDate,
    };
    const itemWarn = inv.addOrUpdateCertificate(certWarn);
    assert.equal(itemWarn.renewal_state, RenewalState.EXPIRING_SOON);
    assert.ok(itemWarn.detected_anomalies.includes("expiring"));
  });

  test("Detects weak keys and deprecated signature algorithms", () => {
    const inv = new CertificateInventory();
    const futureDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Weak RSA key (1024-bit) & SHA-1
    const certWeak = {
      fingerprint: "weak_001",
      subjectName: "CN=weak.example.com",
      algo_family: "RSA",
      key_size: 1024,
      signature_algorithm: "sha1WithRSAEncryption",
      notValidAfter: futureDate,
    };
    const itemWeak = inv.addOrUpdateCertificate(certWeak);
    assert.ok(itemWeak.detected_anomalies.includes("weak_keys"));
    assert.ok(itemWeak.detected_anomalies.includes("deprecated_signatures"));

    // 2. Deprecated MD5 signature
    const certMd5 = {
      fingerprint: "md5_002",
      subjectName: "CN=md5.example.com",
      algo_family: "RSA",
      key_size: 2048,
      signature_algorithm: "md5WithRSAEncryption",
      notValidAfter: futureDate,
    };
    const itemMd5 = inv.addOrUpdateCertificate(certMd5);
    assert.ok(itemMd5.detected_anomalies.includes("deprecated_signatures"));

    // 3. Weak EC curve (< 224 bits)
    const certEc = {
      fingerprint: "ec_003",
      subjectName: "CN=ec.example.com",
      algo_family: "EC",
      key_size: 192,
      signature_algorithm: "ecdsa-with-SHA256",
      notValidAfter: futureDate,
    };
    const itemEc = inv.addOrUpdateCertificate(certEc);
    assert.ok(itemEc.detected_anomalies.includes("weak_keys"));
  });

  test("Detects invalid chains (broken issuer-subject linkage and missing intermediates)", () => {
    const inv = new CertificateInventory();

    // 1. Broken linkage
    const leaf = {
      fingerprint: "broken_leaf",
      subjectName: "CN=leaf.example.com",
      issuerName: "CN=Intermediate A",
    };
    const wrongParent = {
      fingerprint: "wrong_intermediate",
      subjectName: "CN=Intermediate B",
      issuerName: "CN=Root CA",
    };
    const itemBroken = inv.addOrUpdateCertificate(leaf, { chain: [leaf, wrongParent] });
    assert.ok(itemBroken.detected_anomalies.includes("invalid_chains"));

    // 2. Missing intermediate on non-self-signed certificate
    const leafMissing = {
      fingerprint: "missing_intermediate",
      subjectName: "CN=service.internal",
      issuerName: "CN=Corporate CA",
      isSelfSigned: false,
    };
    const itemMissing = inv.addOrUpdateCertificate(leafMissing, { chain: [leafMissing] });
    assert.ok(itemMissing.detected_anomalies.includes("invalid_chains"));
  });

  test("Detects inconsistent deployments", () => {
    const inv = new CertificateInventory();

    // 1. Multiple differing certificates serving the same hostname
    const cert1 = {
      fingerprint: "cert_node_1",
      subjectName: "CN=api.cluster.com",
      sans: ["api.cluster.com"],
      notValidAfter: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const cert2 = {
      fingerprint: "cert_node_2",
      subjectName: "CN=api.cluster.com",
      sans: ["api.cluster.com"],
      notValidAfter: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(),
    };

    inv.addOrUpdateCertificate(cert1, {
      endpoint: { endpoint: "192.168.1.10:443", host: "api.cluster.com", port: 443 },
    });
    inv.addOrUpdateCertificate(cert2, {
      endpoint: { endpoint: "192.168.1.11:443", host: "api.cluster.com", port: 443 },
    });

    const inconsistencies = inv.detectInconsistentDeployments();
    assert.ok(inconsistencies.cert_node_1);
    assert.ok(inconsistencies.cert_node_2);
    assert.ok(
      inv.get("cert_node_1").detected_anomalies.some((a) =>
        a.includes("multiple_certificates_for_host:api.cluster.com")
      )
    );

    // 2. Hostname mismatch
    const certMismatch = {
      fingerprint: "cert_mismatch_001",
      subjectName: "CN=internal.corp",
      sans: ["internal.corp"],
    };
    const itemMismatch = inv.addOrUpdateCertificate(certMismatch, {
      endpoint: { endpoint: "public.corp.com:443", host: "public.corp.com", port: 443 },
    });
    inv.detectInconsistentDeployments();
    assert.ok(
      itemMismatch.detected_anomalies.some((a) => a.includes("hostname_mismatch:public.corp.com"))
    );

    // 3. Self-signed certificate in production
    const certProdSS = {
      fingerprint: "cert_prod_ss",
      subjectName: "CN=gw.prod.corp",
      issuerName: "CN=gw.prod.corp",
      isSelfSigned: true,
    };
    const itemProdSS = inv.addOrUpdateCertificate(certProdSS, { environment: "production" });
    inv.detectInconsistentDeployments();
    assert.ok(
      itemProdSS.detected_anomalies.some((a) => a.includes("production_self_signed"))
    );
  });

  test("STRICT INVARIANT: Never store private key material", () => {
    // 1. Function rejects private key string
    assert.throws(
      () => {
        assertNoPrivateKey("-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...");
      },
      /SECURITY VIOLATION/
    );

    assert.throws(
      () => {
        assertNoPrivateKey("-----BEGIN PRIVATE KEY-----");
      },
      /SECURITY VIOLATION/
    );

    // 2. Ingestion rejects object with private key
    const inv = new CertificateInventory();
    const maliciousCert = {
      fingerprint: "malicious_001",
      subjectName: "CN=test",
      private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...",
    };

    assert.throws(
      () => {
        inv.addOrUpdateCertificate(maliciousCert);
      },
      /SECURITY VIOLATION/
    );
  });

  test("Summary and Filtering", () => {
    const inv = new CertificateInventory();
    const futureDate = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString();

    inv.addOrUpdateCertificate(
      {
        fingerprint: "c1",
        subjectName: "CN=prod1.corp",
        notValidAfter: futureDate,
      },
      { environment: "production", owner: "team-a" }
    );

    inv.addOrUpdateCertificate(
      {
        fingerprint: "c2",
        subjectName: "CN=staging1.corp",
        notValidAfter: futureDate,
      },
      { environment: "staging", owner: "team-b" }
    );

    const prodList = inv.list({ environment: "production" });
    assert.equal(prodList.length, 1);
    assert.equal(prodList[0].fingerprint_sha256, "c1");

    const summary = inv.getSummary();
    assert.equal(summary.total_certificates, 2);
    assert.equal(summary.environments.production, 1);
    assert.equal(summary.environments.staging, 1);
  });
});
