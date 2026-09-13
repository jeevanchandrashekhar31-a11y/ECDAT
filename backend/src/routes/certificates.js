const express = require("express");
const {
  globalCertInventory,
  assertNoPrivateKey,
  RenewalState,
} = require("../domain/certificate_inventory");

const router = express.Router();

/**
 * GET /api/v1/certificates
 * Lists certificate inventory with filtering.
 */
router.get("/", (req, res) => {
  try {
    const filters = {
      environment: req.query.environment,
      renewalState: req.query.renewalState || req.query.renewal_state,
      owner: req.query.owner,
      anomaly: req.query.anomaly,
      expiringWithinDays: req.query.expiringWithinDays || req.query.expiring_within_days,
    };
    const items = globalCertInventory.list(filters);
    return res.json({
      success: true,
      total: items.length,
      certificates: items,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/certificates/summary
 * Returns aggregated renewal state and anomaly summary statistics.
 */
router.get("/summary", (req, res) => {
  try {
    const summary = globalCertInventory.getSummary();
    return res.json({
      success: true,
      summary,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/certificates/anomalies
 * Groups certificates by detected anomaly types.
 */
router.get("/anomalies", (req, res) => {
  try {
    globalCertInventory.detectInconsistentDeployments();
    const all = globalCertInventory.list();

    const grouped = {
      expired: [],
      expiring: [],
      weak_keys: [],
      deprecated_signatures: [],
      invalid_chains: [],
      inconsistent_deployments: [],
    };

    for (const cert of all) {
      for (const a of cert.detected_anomalies) {
        const prefix = a.split(":")[0];
        if (grouped[prefix] && !grouped[prefix].some((c) => c.fingerprint_sha256 === cert.fingerprint_sha256)) {
          grouped[prefix].push(cert);
        }
      }
    }

    return res.json({
      success: true,
      anomalies: grouped,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/certificates/:fingerprint
 * Retrieves a single certificate by fingerprint.
 */
router.get("/:fingerprint", (req, res) => {
  try {
    const cert = globalCertInventory.get(req.params.fingerprint);
    if (!cert) {
      return res.status(404).json({ success: false, error: "Certificate not found" });
    }
    return res.json({ success: true, certificate: cert });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/certificates/ingest
 * Ingests certificate(s) into the inventory.
 * Strictly rejects any private key material.
 */
router.post("/ingest", (req, res) => {
  try {
    const body = req.body;
    assertNoPrivateKey(body);

    const certList = Array.isArray(body) ? body : [body];
    const results = [];

    for (const entry of certList) {
      const certData = entry.certificate || entry;
      const options = {
        chain: entry.chain,
        endpoint: entry.endpoint,
        owner: entry.owner,
        environment: entry.environment || "production",
      };
      const item = globalCertInventory.addOrUpdateCertificate(certData, options);
      results.push(item);
    }

    return res.status(201).json({
      success: true,
      ingested: results.length,
      certificates: results,
    });
  } catch (err) {
    const status = err.message.includes("SECURITY VIOLATION") ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = router;
