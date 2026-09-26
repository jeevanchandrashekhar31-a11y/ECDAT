const express = require("express");
const { buildCryptoRelationshipGraph } = require("../services/crypto_graph_service");
const { calculateMosca } = require("../risk_engine");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { quantum_arrival_year, scanId } = req.query;
    if (!quantum_arrival_year) {
      return res.status(400).json({ error: "Missing quantum_arrival_year parameter" });
    }

    const year = Number(quantum_arrival_year);
    if (isNaN(year)) {
      return res.status(400).json({ error: "Invalid quantum_arrival_year parameter" });
    }

    const currentYear = new Date().getFullYear();
    const hypotheticalZ = year - currentYear;

    // Use existing graph logic to fetch all nodes
    const graphData = await buildCryptoRelationshipGraph({ scanId }, req.tenantContext);
    
    // Removed synthetic mock injection block
    const projection = [];

    for (const node of graphData.graph.nodes) {
      let customX = null;
      let customY = null;
      let assetType = node.type || "cryptographic_asset";
      let dataSensitivity = "internal";
      let businessCriticality = "medium";
      let quantumRelevance = "shor_vulnerable"; // Default for algorithms
      let isIntegrityOnly = false;

      // Extract x and y from metadata or other fields
      if (node.metadata) {
        if (node.metadata.mosca_x_years !== undefined) customX = Number(node.metadata.mosca_x_years);
        else if (node.metadata.shelf_life_years !== undefined) customX = Number(node.metadata.shelf_life_years);

        if (node.metadata.mosca_y_years !== undefined) customY = Number(node.metadata.mosca_y_years);
        else if (node.metadata.migration_years !== undefined) customY = Number(node.metadata.migration_years);
      }
      
      // If we don't have explicit data on the node, check evidence items (findings)
      if ((customX === null || customY === null) && node.evidence_items) {
          for (const evId of node.evidence_items) {
             const ev = graphData.evidence_lookup[evId];
             if (ev) {
               if (ev.quantum_relevance) quantumRelevance = ev.quantum_relevance;
               if (ev.mosca_x_years !== undefined) customX = Number(ev.mosca_x_years);
               if (ev.mosca_y_years !== undefined) customY = Number(ev.mosca_y_years);
               if (customX !== null && customY !== null) break;
             }
          }
      }
      
      // Also grab values from nodes properties if they exist
      if (node.data_sensitivity) dataSensitivity = node.data_sensitivity;
      if (node.business_criticality) businessCriticality = node.business_criticality;
      if (node.pqc_readiness === "SAFE") quantumRelevance = "Not Vulnerable";

      if (customX === null || customY === null) {
        projection.push({
          id: node.id,
          status: "INSUFFICIENT_EVIDENCE_FOR_PROJECTION",
        });
      } else {
        if (node.id === "app_root") {
            console.log("APP_ROOT PARAMS:", {
              assetType,
              dataSensitivity,
              businessCriticality,
              quantumRelevance,
              isIntegrityOnly,
              customX,
              customY,
              customZ: hypotheticalZ,
            });
        }
        // Use the existing Mosca calculation wrapped!
        const moscaResult = calculateMosca({
            assetType,
            dataSensitivity,
            businessCriticality,
            quantumRelevance: quantumRelevance.toUpperCase().includes("SHOR") ? "shor_vulnerable" : "not_applicable",
            isIntegrityOnly,
            customX,
            customY,
            customZ: hypotheticalZ,
        });
        
        if (moscaResult.status === "CRITICAL_URGENT" || moscaResult.status === "AT_RISK") {
          projection.push({
            id: node.id,
            status: "AFFECTED",
            deficit: moscaResult.mosca_margin_years,
            mosca_total: moscaResult.mosca_total_years
          });
        } else {
          projection.push({
            id: node.id,
            status: "SAFE",
            margin: Math.abs(moscaResult.mosca_margin_years),
            mosca_total: moscaResult.mosca_total_years,
            debug: { customX, customY, customZ: hypotheticalZ, quantumRelevance }
          });
        }
      }
    }

    res.status(200).json({
      quantum_arrival_year: year,
      hypothetical_z: hypotheticalZ,
      projection: projection
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
