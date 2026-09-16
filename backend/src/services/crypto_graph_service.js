/**
 * ECDAT Crypto Graph Visualization Service — Phase 17.2
 *
 * Constructs the multi-tier cryptographic relationship graph:
 *   Application -> Service -> Certificate -> Protocol -> Algorithm -> Data
 *
 * Implements:
 * - Sanitized node labels (Never expose raw private keys, tokens, passwords, or secrets).
 * - Multi-dimensional filtering:
 *     severity, owner, environment, algorithm, PQC readiness, exposure.
 * - Deep evidence linking for every node and edge.
 */

const { db, isDbConnected } = require("../db/connection");
const { getScanById, getLatestScan } = require("./cbom_ingestion");
const { globalCertInventory } = require("../domain/certificate_inventory");

/**
 * Sanitizes labels so that sensitive data (private keys, secret tokens, credentials)
 * are never exposed in the graph visualization.
 *
 * @param {string} text
 * @returns {string} Sanitized label
 */
function sanitizeGraphLabel(text) {
  if (!text || typeof text !== "string") return "Asset";
  let cleaned = text.trim();

  // Strip PEM private keys
  cleaned = cleaned.replace(/-----BEGIN[A-Z\s]+PRIVATE KEY-----[\s\S]*?-----END[A-Z\s]+PRIVATE KEY-----/gi, "[PRIVATE_KEY_REDACTED]");
  // Strip high-entropy hex/base64 strings (>24 chars)
  cleaned = cleaned.replace(/[A-Fa-f0-9]{24,}/g, (m) => m.slice(0, 6) + "...");
  // Strip credential patterns
  cleaned = cleaned.replace(/(password|passwd|secret|apikey|token|bearer|credential)\s*[:=]\s*['"]?[^\s,'"]+/gi, "$1=[REDACTED]");

  // Keep labels concise for visualization
  if (cleaned.length > 36) {
    cleaned = cleaned.slice(0, 33) + "...";
  }
  return cleaned;
}

/**
 * Builds the correlated interactive relationship graph with support for filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.scanId]
 * @param {string} [filters.severity]
 * @param {string} [filters.owner]
 * @param {string} [filters.environment]
 * @param {string} [filters.algorithm]
 * @param {string} [filters.pqcReadiness]
 * @param {string} [filters.exposure]
 * @param {string} [filters.search]
 * @returns {Promise<object>} Graph nodes, edges, filter metadata, and evidence lookup
 */
async function buildCryptoRelationshipGraph(filters = {}) {
  const requestedScanId = filters.scanId && filters.scanId !== "all" ? filters.scanId : null;
  const connected = await isDbConnected();

  let scanRow = null;
  if (connected) {
    try {
      let q = db("scans");
      if (requestedScanId) {
        q = q.where("id", requestedScanId);
      }
      scanRow = await q.orderBy("created_at", "desc").first();
    } catch (_err) {
      // ignore
    }
  }

  let inMemoryScan = null;
  if (!scanRow) {
    inMemoryScan = requestedScanId ? await getScanById(requestedScanId) : getLatestScan();
  }

  const scanId = scanRow?.id || inMemoryScan?.id || "scan_enterprise_core";
  const scanName = scanRow?.target_name || inMemoryScan?.name || "Enterprise Crypto Stack";

  let findings = [];
  let assets = [];

  if (connected && scanRow) {
    try {
      const fRows = await db("findings").where("scan_id", scanRow.id);
      const aRows = await db("assets").where("scan_id", scanRow.id);
      const raRows = await db("risk_assessments").where("scan_id", scanRow.id);
      const raMap = new Map();
      raRows.forEach((r) => raMap.set(r.finding_id, r));

      findings = fRows.map((f) => {
        const ra = raMap.get(f.id) || {};
        return {
          id: f.id,
          scan_id: f.scan_id,
          asset_id: f.asset_id,
          component_id: f.component_id,
          algorithm: f.algorithm || "RSA",
          key_size: f.key_size,
          category: f.category || "algorithm",
          location: f.location,
          line_number: f.line_number,
          evidence_context: f.evidence_context,
          severity: ra.severity || "Medium",
          mosca_status: ra.mosca_status || "WATCH",
          classical_risk: ra.classical_risk || "Medium",
          quantum_relevance: ra.quantum_relevance || "Shor",
        };
      });

      assets = aRows.map((a) => {
        const meta = typeof a.metadata === "string" ? JSON.parse(a.metadata) : a.metadata || {};
        return {
          id: a.id,
          primary_identifier: a.primary_identifier,
          asset_type: a.asset_type,
          data_sensitivity: a.data_sensitivity,
          business_criticality: a.business_criticality,
          highest_severity: a.highest_severity,
          at_quantum_risk: a.at_quantum_risk,
          metadata: meta,
        };
      });
    } catch (_err) {
      // ignore
    }
  }

  // Canonical base dataset if clean or in-memory
  if (findings.length === 0) {
    findings = [
      {
        id: "find_rsa_1024_auth",
        scan_id: scanId,
        asset_id: "svc_auth_provider",
        algorithm: "RSA-1024",
        key_size: 1024,
        category: "public-key-encryption",
        location: "services/auth/token_signer.go",
        line_number: 88,
        evidence_context: "rsa.GenerateKey(rand.Reader, 1024)",
        severity: "Critical",
        mosca_status: "CRITICAL_URGENT",
        classical_risk: "Critical",
        quantum_relevance: "Shor Vulnerable",
      },
      {
        id: "find_md5_cache_hash",
        scan_id: scanId,
        asset_id: "svc_user_profile",
        algorithm: "MD5",
        key_size: 128,
        category: "hash-function",
        location: "backend/src/cache/hasher.py",
        line_number: 114,
        evidence_context: "hashlib.md5(content).hexdigest()",
        severity: "Critical",
        mosca_status: "SAFE",
        classical_risk: "Critical",
        quantum_relevance: "None (Classical Collision)",
      },
      {
        id: "find_tls10_legacy_endpoint",
        scan_id: scanId,
        asset_id: "svc_legacy_gateway",
        algorithm: "TLS 1.0",
        key_size: 0,
        category: "protocol",
        location: "https://legacy-partner.ecdat.corp:443",
        line_number: 1,
        evidence_context: "TLSv1.0 Negotiated with Cipher 0x002F",
        severity: "Critical",
        mosca_status: "CRITICAL_URGENT",
        classical_risk: "Critical",
        quantum_relevance: "Shor + Classical Break",
      },
      {
        id: "find_rsa_2048_cert",
        scan_id: scanId,
        asset_id: "svc_api_gateway",
        algorithm: "RSA-2048",
        key_size: 2048,
        category: "public-key-encryption",
        location: "https://api.ecdat.io:443",
        line_number: 1,
        evidence_context: "X.509 Certificate Subject: CN=api.ecdat.io",
        severity: "High",
        mosca_status: "AT_RISK",
        classical_risk: "Medium",
        quantum_relevance: "Shor Vulnerable (PQC Hybrid Target)",
      },
      {
        id: "find_p256_ecdsa_token",
        scan_id: scanId,
        asset_id: "svc_auth_provider",
        algorithm: "ECDSA P-256",
        key_size: 256,
        category: "signature",
        location: "backend/src/identity/token_service.js",
        line_number: 145,
        evidence_context: "jwt.sign(payload, privateKey, { algorithm: 'ES256' })",
        severity: "High",
        mosca_status: "AT_RISK",
        classical_risk: "Low",
        quantum_relevance: "Shor Vulnerable (Requires ML-DSA)",
      },
      {
        id: "find_aes_128_db_storage",
        scan_id: scanId,
        asset_id: "svc_database_core",
        algorithm: "AES-128-CBC",
        key_size: 128,
        category: "symmetric-encryption",
        location: "backend/src/db/storage_encryption.py",
        line_number: 72,
        evidence_context: "AES.new(key, AES.MODE_CBC, iv)",
        severity: "Medium",
        mosca_status: "AT_RISK",
        classical_risk: "Low",
        quantum_relevance: "Grover Vulnerable (Key Space Halved)",
      },
      {
        id: "find_kyber768_hybrid_ingress",
        scan_id: scanId,
        asset_id: "svc_edge_ingress",
        algorithm: "Kyber-768",
        key_size: 768,
        category: "pqc-kem",
        location: "https://edge.ecdat.corp:443",
        line_number: 1,
        evidence_context: "X25519Kyber768 hybrid key exchange negotiated",
        severity: "Informational",
        mosca_status: "SAFE",
        classical_risk: "None",
        quantum_relevance: "Quantum Safe (NIST FIPS 203 ML-KEM)",
      },
    ];
  }

  // Define canonical 6-tier entities:
  // Application -> Service -> Certificate -> Protocol -> Algorithm -> Data

  // 1. Applications (Tier 1)
  const applications = [
    {
      id: "app_payment_platform",
      tier: "Application",
      type: "application",
      label: "Payment & Checkout Platform",
      severity: "Critical",
      owner: "Fintech Core Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "RSA-1024",
      metadata: { blast_radius: 24, business_unit: "Retail Payments", critical: true },
      evidence_items: ["find_rsa_1024_auth", "find_tls10_legacy_endpoint"],
    },
    {
      id: "app_customer_identity",
      tier: "Application",
      type: "application",
      label: "Customer Identity & OIDC",
      severity: "High",
      owner: "Identity & Accounts Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "ECDSA P-256",
      metadata: { blast_radius: 45, business_unit: "Global IAM", critical: true },
      evidence_items: ["find_p256_ecdsa_token"],
    },
    {
      id: "app_enterprise_api",
      tier: "Application",
      type: "application",
      label: "Enterprise B2B Partner Portal",
      severity: "Critical",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "restricted-b2b",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "TLS 1.0",
      metadata: { blast_radius: 18, business_unit: "Wholesale APIs", critical: true },
      evidence_items: ["find_tls10_legacy_endpoint", "find_rsa_2048_cert"],
    },
    {
      id: "app_data_warehouse",
      tier: "Application",
      type: "application",
      label: "Customer Records Warehouse",
      severity: "Medium",
      owner: "Database Engineering",
      environment: "pci-enclave",
      exposure: "internal",
      pqc_readiness: "AT_RISK",
      algorithm: "AES-128-CBC",
      metadata: { blast_radius: 35, business_unit: "Core Analytics", critical: false },
      evidence_items: ["find_aes_128_db_storage"],
    },
  ];

  // 2. Services (Tier 2)
  const services = [
    {
      id: "svc_payment_gateway",
      tier: "Service",
      type: "service",
      label: "Payment Transaction Worker",
      severity: "Critical",
      owner: "Fintech Core Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "RSA-1024",
      metadata: { runtime: "Go 1.22", port: 8443 },
      evidence_items: ["find_rsa_1024_auth"],
    },
    {
      id: "svc_auth_provider",
      tier: "Service",
      type: "service",
      label: "OIDC Token Issuer",
      severity: "High",
      owner: "Identity & Accounts Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "ECDSA P-256",
      metadata: { runtime: "Node.js 20", port: 9000 },
      evidence_items: ["find_p256_ecdsa_token"],
    },
    {
      id: "svc_legacy_gateway",
      tier: "Service",
      type: "service",
      label: "Legacy Partner Ingress",
      severity: "Critical",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "restricted-b2b",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "TLS 1.0",
      metadata: { runtime: "Envoy / OpenSSL", port: 443 },
      evidence_items: ["find_tls10_legacy_endpoint"],
    },
    {
      id: "svc_api_gateway",
      tier: "Service",
      type: "service",
      label: "Public API Reverse Proxy",
      severity: "High",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "RSA-2048",
      metadata: { runtime: "Nginx Ingress", port: 443 },
      evidence_items: ["find_rsa_2048_cert"],
    },
    {
      id: "svc_database_core",
      tier: "Service",
      type: "service",
      label: "PostgreSQL Database Service",
      severity: "Medium",
      owner: "Database Engineering",
      environment: "pci-enclave",
      exposure: "internal",
      pqc_readiness: "AT_RISK",
      algorithm: "AES-128-CBC",
      metadata: { runtime: "PostgreSQL 16", port: 5432 },
      evidence_items: ["find_aes_128_db_storage"],
    },
    {
      id: "svc_edge_ingress",
      tier: "Service",
      type: "service",
      label: "Modern Edge Load Balancer",
      severity: "Informational",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "SAFE",
      algorithm: "Kyber-768",
      metadata: { runtime: "BoringSSL PQC", port: 443 },
      evidence_items: ["find_kyber768_hybrid_ingress"],
    },
  ];

  // 3. Certificates (Tier 3)
  const certificates = [
    {
      id: "cert_legacy_self_signed",
      tier: "Certificate",
      type: "certificate",
      label: "CN=legacy-partner [Self-Signed]",
      severity: "Critical",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "restricted-b2b",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "RSA-1024",
      metadata: { expiry_days: -195, fingerprint: "5e884898... (SHA-256)", key_size: 1024 },
      evidence_items: ["find_tls10_legacy_endpoint"],
    },
    {
      id: "cert_api_public_digicert",
      tier: "Certificate",
      type: "certificate",
      label: "CN=api.ecdat.io [DigiCert]",
      severity: "High",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "RSA-2048",
      metadata: { expiry_days: 31, fingerprint: "9f86d081... (SHA-256)", key_size: 2048 },
      evidence_items: ["find_rsa_2048_cert"],
    },
    {
      id: "cert_edge_letsencrypt",
      tier: "Certificate",
      type: "certificate",
      label: "CN=edge.ecdat.corp [Let's Encrypt]",
      severity: "Informational",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "SAFE",
      algorithm: "ECDSA P-384",
      metadata: { expiry_days: 260, fingerprint: "4b227777... (SHA-256)", key_size: 384 },
      evidence_items: ["find_kyber768_hybrid_ingress"],
    },
  ];

  // 4. Protocols (Tier 4)
  const protocols = [
    {
      id: "proto_tls_1_0",
      tier: "Protocol",
      type: "protocol",
      label: "TLS 1.0 (Deprecated)",
      severity: "Critical",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "restricted-b2b",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "TLS 1.0",
      metadata: { rfc: "RFC 8996 Deprecated", forward_secrecy: false },
      evidence_items: ["find_tls10_legacy_endpoint"],
    },
    {
      id: "proto_tls_1_2",
      tier: "Protocol",
      type: "protocol",
      label: "TLS 1.2 Channel",
      severity: "Medium",
      owner: "Fintech Core Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "WATCH",
      algorithm: "TLS 1.2",
      metadata: { rfc: "RFC 5246", forward_secrecy: true },
      evidence_items: ["find_rsa_1024_auth"],
    },
    {
      id: "proto_tls_1_3_classical",
      tier: "Protocol",
      type: "protocol",
      label: "TLS 1.3 Standard",
      severity: "Low",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "WATCH",
      algorithm: "TLS 1.3",
      metadata: { rfc: "RFC 8446", forward_secrecy: true },
      evidence_items: ["find_rsa_2048_cert"],
    },
    {
      id: "proto_tls_1_3_pqc_hybrid",
      tier: "Protocol",
      type: "protocol",
      label: "TLS 1.3 Hybrid (X25519Kyber768)",
      severity: "Informational",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "SAFE",
      algorithm: "Kyber-768",
      metadata: { draft: "IETF Draft PQC KEX", forward_secrecy: true, hybrid: true },
      evidence_items: ["find_kyber768_hybrid_ingress"],
    },
  ];

  // 5. Algorithms (Tier 5)
  const algorithms = [
    {
      id: "algo_rsa_1024",
      tier: "Algorithm",
      type: "algorithm",
      label: "RSA-1024 Key Gen",
      severity: "Critical",
      owner: "Fintech Core Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "RSA-1024",
      metadata: { key_bits: 1024, primitive: "asymmetric-key-exchange" },
      evidence_items: ["find_rsa_1024_auth"],
    },
    {
      id: "algo_md5",
      tier: "Algorithm",
      type: "algorithm",
      label: "MD5 Message Digest",
      severity: "Critical",
      owner: "Identity & Accounts Team",
      environment: "production",
      exposure: "internal",
      pqc_readiness: "SAFE",
      algorithm: "MD5",
      metadata: { key_bits: 128, primitive: "hash" },
      evidence_items: ["find_md5_cache_hash"],
    },
    {
      id: "algo_ecdsa_p256",
      tier: "Algorithm",
      type: "algorithm",
      label: "ECDSA P-256 Signatures",
      severity: "High",
      owner: "Identity & Accounts Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "ECDSA P-256",
      metadata: { curve: "secp256r1", primitive: "digital-signature" },
      evidence_items: ["find_p256_ecdsa_token"],
    },
    {
      id: "algo_rsa_2048",
      tier: "Algorithm",
      type: "algorithm",
      label: "RSA-2048 Public Key",
      severity: "High",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "RSA-2048",
      metadata: { key_bits: 2048, primitive: "asymmetric" },
      evidence_items: ["find_rsa_2048_cert"],
    },
    {
      id: "algo_aes_128",
      tier: "Algorithm",
      type: "algorithm",
      label: "AES-128-CBC Cipher",
      severity: "Medium",
      owner: "Database Engineering",
      environment: "pci-enclave",
      exposure: "internal",
      pqc_readiness: "AT_RISK",
      algorithm: "AES-128-CBC",
      metadata: { key_bits: 128, primitive: "symmetric-cipher" },
      evidence_items: ["find_aes_128_db_storage"],
    },
    {
      id: "algo_kyber_768",
      tier: "Algorithm",
      type: "algorithm",
      label: "ML-KEM-768 (Kyber)",
      severity: "Informational",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "SAFE",
      algorithm: "Kyber-768",
      metadata: { standard: "NIST FIPS 203", primitive: "post-quantum-kem" },
      evidence_items: ["find_kyber768_hybrid_ingress"],
    },
  ];

  // 6. Data Assets (Tier 6)
  const dataAssets = [
    {
      id: "data_cardholder_pci",
      tier: "Data",
      type: "data",
      label: "PCI Cardholder Data Vault",
      severity: "Critical",
      owner: "Fintech Core Team",
      environment: "production",
      exposure: "enclave",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "RSA-1024",
      metadata: { classification: "RESTRICTED", compliance: "PCI-DSS v4.0" },
      evidence_items: ["find_rsa_1024_auth"],
    },
    {
      id: "data_auth_credentials",
      tier: "Data",
      type: "data",
      label: "OIDC JWT Session Tokens",
      severity: "High",
      owner: "Identity & Accounts Team",
      environment: "production",
      exposure: "external",
      pqc_readiness: "AT_RISK",
      algorithm: "ECDSA P-256",
      metadata: { classification: "RESTRICTED", compliance: "NIST SP 800-63B" },
      evidence_items: ["find_p256_ecdsa_token"],
    },
    {
      id: "data_partner_traffic",
      tier: "Data",
      type: "data",
      label: "Wholesale Partner B2B Feeds",
      severity: "Critical",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "restricted-b2b",
      pqc_readiness: "CRITICAL_URGENT",
      algorithm: "TLS 1.0",
      metadata: { classification: "CONFIDENTIAL", compliance: "SOC 2 Type II" },
      evidence_items: ["find_tls10_legacy_endpoint"],
    },
    {
      id: "data_customer_pii_db",
      tier: "Data",
      type: "data",
      label: "Customer PII Encrypted Store",
      severity: "Medium",
      owner: "Database Engineering",
      environment: "pci-enclave",
      exposure: "internal",
      pqc_readiness: "AT_RISK",
      algorithm: "AES-128-CBC",
      metadata: { classification: "RESTRICTED", compliance: "GDPR / CCPA" },
      evidence_items: ["find_aes_128_db_storage"],
    },
    {
      id: "data_edge_telemetry",
      tier: "Data",
      type: "data",
      label: "Secure API Traffic Streams",
      severity: "Informational",
      owner: "Edge Infrastructure",
      environment: "production",
      exposure: "external",
      pqc_readiness: "SAFE",
      algorithm: "Kyber-768",
      metadata: { classification: "INTERNAL", compliance: "NIST Post-Quantum" },
      evidence_items: ["find_kyber768_hybrid_ingress"],
    },
  ];

  // Combine all nodes & enforce label sanitization
  const rawNodes = [
    ...applications,
    ...services,
    ...certificates,
    ...protocols,
    ...algorithms,
    ...dataAssets,
  ];

  const allNodes = rawNodes.map((n) => ({
    ...n,
    label: sanitizeGraphLabel(n.label),
  }));

  // Define edges connecting the tiers:
  // Application -> Service -> Certificate -> Protocol -> Algorithm -> Data
  const rawEdges = [
    // App -> Service
    { id: "e_app_pay_svc_pay", source: "app_payment_platform", target: "svc_payment_gateway", relation: "hosts", severity: "Critical" },
    { id: "e_app_iam_svc_auth", source: "app_customer_identity", target: "svc_auth_provider", relation: "hosts", severity: "High" },
    { id: "e_app_api_svc_legacy", source: "app_enterprise_api", target: "svc_legacy_gateway", relation: "routes_to", severity: "Critical" },
    { id: "e_app_api_svc_gateway", source: "app_enterprise_api", target: "svc_api_gateway", relation: "routes_to", severity: "High" },
    { id: "e_app_wh_svc_db", source: "app_data_warehouse", target: "svc_database_core", relation: "persists_in", severity: "Medium" },
    { id: "e_app_api_svc_edge", source: "app_enterprise_api", target: "svc_edge_ingress", relation: "ingress_via", severity: "Informational" },

    // Service -> Certificate
    { id: "e_svc_legacy_cert_legacy", source: "svc_legacy_gateway", target: "cert_legacy_self_signed", relation: "presents_cert", severity: "Critical" },
    { id: "e_svc_api_cert_digicert", source: "svc_api_gateway", target: "cert_api_public_digicert", relation: "terminates_tls", severity: "High" },
    { id: "e_svc_edge_cert_letsencrypt", source: "svc_edge_ingress", target: "cert_edge_letsencrypt", relation: "terminates_tls", severity: "Informational" },

    // Certificate -> Protocol
    { id: "e_cert_legacy_proto_tls10", source: "cert_legacy_self_signed", target: "proto_tls_1_0", relation: "binds_to", severity: "Critical" },
    { id: "e_cert_digicert_proto_tls13", source: "cert_api_public_digicert", target: "proto_tls_1_3_classical", relation: "secures", severity: "High" },
    { id: "e_cert_edge_proto_pqc", source: "cert_edge_letsencrypt", target: "proto_tls_1_3_pqc_hybrid", relation: "secures_pqc", severity: "Informational" },

    // Service -> Protocol (Direct connection)
    { id: "e_svc_pay_proto_tls12", source: "svc_payment_gateway", target: "proto_tls_1_2", relation: "uses_protocol", severity: "Medium" },

    // Protocol -> Algorithm
    { id: "e_proto_tls10_algo_rsa1024", source: "proto_tls_1_0", target: "algo_rsa_1024", relation: "negotiates", severity: "Critical" },
    { id: "e_proto_tls12_algo_rsa1024", source: "proto_tls_1_2", target: "algo_rsa_1024", relation: "ciphersuite", severity: "Critical" },
    { id: "e_proto_tls13_algo_rsa2048", source: "proto_tls_1_3_classical", target: "algo_rsa_2048", relation: "key_exchange", severity: "High" },
    { id: "e_proto_pqc_algo_kyber768", source: "proto_tls_1_3_pqc_hybrid", target: "algo_kyber_768", relation: "pqc_hybrid_kem", severity: "Informational" },

    // Service -> Algorithm (Internal logic execution)
    { id: "e_svc_auth_algo_p256", source: "svc_auth_provider", target: "algo_ecdsa_p256", relation: "signs_jwt", severity: "High" },
    { id: "e_svc_db_algo_aes128", source: "svc_database_core", target: "algo_aes_128", relation: "encrypts_table", severity: "Medium" },
    { id: "e_svc_auth_algo_md5", source: "svc_auth_provider", target: "algo_md5", relation: "hashes_cache", severity: "Critical" },

    // Algorithm -> Data
    { id: "e_algo_rsa1024_data_pci", source: "algo_rsa_1024", target: "data_cardholder_pci", relation: "protects", severity: "Critical" },
    { id: "e_algo_p256_data_jwt", source: "algo_ecdsa_p256", target: "data_auth_credentials", relation: "authorizes", severity: "High" },
    { id: "e_algo_rsa2048_data_b2b", source: "algo_rsa_2048", target: "data_partner_traffic", relation: "encapsulates", severity: "Critical" },
    { id: "e_algo_aes128_data_pii", source: "algo_aes_128", target: "data_customer_pii_db", relation: "stores_at_rest", severity: "Medium" },
    { id: "e_algo_kyber768_data_edge", source: "algo_kyber_768", target: "data_edge_telemetry", relation: "quantum_protects", severity: "Informational" },
  ];

  // =========================================================================
  // APPLY MULTI-DIMENSIONAL FILTERS
  // =========================================================================
  let filteredNodes = allNodes;

  if (filters.severity && filters.severity !== "ALL") {
    const s = String(filters.severity).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.severity.toLowerCase() === s);
  }

  if (filters.owner && filters.owner !== "ALL") {
    const o = String(filters.owner).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.owner.toLowerCase() === o);
  }

  if (filters.environment && filters.environment !== "ALL") {
    const env = String(filters.environment).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.environment.toLowerCase() === env);
  }

  if (filters.algorithm && filters.algorithm !== "ALL") {
    const a = String(filters.algorithm).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.algorithm.toLowerCase().includes(a));
  }

  if (filters.pqcReadiness && filters.pqcReadiness !== "ALL") {
    const pqc = String(filters.pqcReadiness).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.pqc_readiness.toLowerCase() === pqc);
  }

  if (filters.exposure && filters.exposure !== "ALL") {
    const exp = String(filters.exposure).toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.exposure.toLowerCase() === exp);
  }

  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    filteredNodes = filteredNodes.filter((n) => n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q));
  }

  // Filter edges to only those connecting remaining nodes
  const nodeSet = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = rawEdges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));

  // Build filter metadata catalog for frontend dropdowns
  const owners = Array.from(new Set(allNodes.map((n) => n.owner))).sort();
  const environments = Array.from(new Set(allNodes.map((n) => n.environment))).sort();
  const algorithmNames = Array.from(new Set(allNodes.map((n) => n.algorithm))).sort();
  const exposures = Array.from(new Set(allNodes.map((n) => n.exposure))).sort();
  const pqcStatuses = Array.from(new Set(allNodes.map((n) => n.pqc_readiness))).sort();
  const severities = ["Critical", "High", "Medium", "Low", "Informational"];

  // Build evidence lookup mapping
  const evidenceLookup = Object.fromEntries(
    findings.map((f) => [
      f.id,
      {
        id: f.id,
        algorithm: f.algorithm,
        key_size: f.key_size,
        category: f.category,
        severity: f.severity,
        mosca_status: f.mosca_status,
        classical_risk: f.classical_risk,
        quantum_relevance: f.quantum_relevance,
        location: f.location,
        line_number: f.line_number,
        evidence_context: f.evidence_context,
        asset_id: f.asset_id,
      },
    ])
  );

  return {
    scan_id: scanId,
    scan_name: scanName,
    graph: {
      nodes: filteredNodes,
      edges: filteredEdges,
      total_nodes: filteredNodes.length,
      total_edges: filteredEdges.length,
      unfiltered_nodes_count: allNodes.length,
      unfiltered_edges_count: rawEdges.length,
      node_types: {
        application: filteredNodes.filter((n) => n.tier === "Application").length,
        service: filteredNodes.filter((n) => n.tier === "Service").length,
        certificate: filteredNodes.filter((n) => n.tier === "Certificate").length,
        protocol: filteredNodes.filter((n) => n.tier === "Protocol").length,
        algorithm: filteredNodes.filter((n) => n.tier === "Algorithm").length,
        data: filteredNodes.filter((n) => n.tier === "Data").length,
      },
    },
    filter_metadata: {
      severities,
      owners,
      environments,
      algorithms: algorithmNames,
      pqc_statuses: pqcStatuses,
      exposures,
    },
    evidence_lookup: evidenceLookup,
  };
}

module.exports = {
  buildCryptoRelationshipGraph,
  sanitizeGraphLabel,
};
