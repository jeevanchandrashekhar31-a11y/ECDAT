const { classifyFinding } = require("./classifier");
const { getRules } = require("./rules_loader");

/**
 * Extracts algorithm and property hints from a CycloneDX 1.6 component.
 */
function extractComponentCryptoDetails(component) {
  let algorithm = component.name || "";
  let keySize = null;
  let assetType = "file";
  let category = null;
  let evidenceType = null;
  let certificateProperties = null;
  let protocolProperties = null;

  const cryptoProps = component.cryptoProperties;
  if (cryptoProps) {
    const cpAssetType = cryptoProps.assetType;
    if (cpAssetType === "protocol") {
      assetType = "network_session";
      category = "protocol";
      protocolProperties = cryptoProps.protocolProperties || {};
      if (protocolProperties.version) {
        algorithm = protocolProperties.version;
      }
    } else if (cpAssetType === "certificate") {
      assetType = "certificate";
      category = "digital_signature";
      certificateProperties = cryptoProps.certificateProperties || {};
    } else if (cpAssetType === "related-crypto-material") {
      assetType = "hardcoded_private_key";
      category = "key_material";
    } else if (cpAssetType === "algorithm") {
      if (component["bom-ref"]?.startsWith("net:")) {
        assetType = "network_session";
        category = "key_exchange";
      }
      const algoProps = cryptoProps.algorithmProperties || {};
      if (algoProps.parameterSetIdentifier) {
        const size = parseInt(algoProps.parameterSetIdentifier, 10);
        if (!isNaN(size)) keySize = size;
      }
      if (algoProps.algorithmFamily === "ECC/DH" || algoProps.algorithmFamily === "DH") {
        category = "key_exchange";
      }
    }
  }

  // Component type overrides
  if (component.type === "library") {
    assetType = "library_presence";
    evidenceType = "package_inventory";
  }

  // Extract from properties if available
  const properties = component.properties || [];
  for (const prop of properties) {
    if (prop.name === "ecdat:evidence_type") {
      evidenceType = prop.value;
    }
    if (prop.name === "ecdat:isSelfSigned") {
      certificateProperties = certificateProperties || {};
      certificateProperties.isSelfSigned = prop.value === "true";
    }
    if (prop.name === "ecdat:isExpired") {
      certificateProperties = certificateProperties || {};
      certificateProperties.isExpired = prop.value === "true";
    }
    if (prop.name === "ecdat:algorithm") {
      algorithm = prop.value;
    }
    if (prop.name === "ecdat:key_size") {
      const size = parseInt(prop.value, 10);
      if (!isNaN(size)) keySize = size;
    }
  }

  return {
    algorithm,
    keySize,
    assetType,
    category,
    evidenceType,
    certificateProperties,
    protocolProperties,
  };
}

/**
 * Enriches a CycloneDX 1.6 CBOM with ECDAT risk annotations in component.properties,
 * preserving full CycloneDX validity and original evidence.
 *
 * @param {Object} cbomData - CycloneDX 1.6 JSON document or component array
 * @param {Object} [options]
 * @param {string} [options.policyProfile='internal_enterprise']
 * @param {string} [options.scenario='baseline']
 * @returns {Object} Risk-annotated CycloneDX document
 */
function annotateCbom(cbomData, options = {}) {
  const policyProfile = options.policyProfile || "internal_enterprise";
  const scenario = options.scenario || "baseline";
  const rules = getRules();
  const ruleVersion = rules.algorithm_risk?.version || "1.0.0";

  // Deep clone to avoid mutating input
  const annotatedBOM = JSON.parse(JSON.stringify(cbomData));

  // Determine components list
  let components = [];
  if (Array.isArray(annotatedBOM)) {
    // If given array of targets with findings
    for (const item of annotatedBOM) {
      if (Array.isArray(item.findings)) {
        components.push(...item.findings);
      } else if (item.type) {
        components.push(item);
      }
    }
  } else if (Array.isArray(annotatedBOM.components)) {
    components = annotatedBOM.components;
  }

  const classifiedResults = [];

  for (const comp of components) {
    // Skip root target containers (e.g. host application/service) that are not crypto assets or libraries
    if (
      (comp.type === "application" || comp.type === "service" || comp.type === "device") &&
      !comp.cryptoProperties &&
      comp.type !== "cryptographic-asset"
    ) {
      continue;
    }

    const details = extractComponentCryptoDetails(comp);
    const findingContext = comp["bom-ref"] || comp.name || "crypto-asset";

    // Run classification
    const classification = classifyFinding({
      algorithm: details.algorithm,
      keySize: details.keySize,
      assetType: details.assetType,
      category: details.category,
      evidenceType: details.evidenceType,
      policyProfile,
      scenario,
      certificateProperties: details.certificateProperties,
      protocolProperties: details.protocolProperties,
      evidenceContext: findingContext,
    });

    classification.bom_ref = comp["bom-ref"] || comp.name;
    classifiedResults.push(classification);

    // Attach to component.properties without overwriting scanner properties
    comp.properties = comp.properties || [];

    // Filter out any previous ecdat:risk properties if re-annotating
    comp.properties = comp.properties.filter(
      (p) => !p.name.startsWith("ecdat:risk:"),
    );

    comp.properties.push(
      { name: "ecdat:risk:rule_version", value: ruleVersion },
      { name: "ecdat:risk:policy_profile", value: policyProfile },
      { name: "ecdat:risk:severity", value: classification.severity },
      {
        name: "ecdat:risk:classical_risk",
        value: classification.classical_risk,
      },
      {
        name: "ecdat:risk:quantum_relevance",
        value: classification.quantum_relevance,
      },
      { name: "ecdat:risk:cicd_pass", value: String(classification.cicd_pass) },
      {
        name: "ecdat:risk:mosca_status",
        value: classification.mosca?.status || "SAFE",
      },
      {
        name: "ecdat:risk:mosca_total_years",
        value: String(classification.mosca?.mosca_total_years ?? ""),
      },
      {
        name: "ecdat:risk:mosca_margin_years",
        value: String(classification.mosca?.mosca_margin_years ?? ""),
      },
      {
        name: "ecdat:risk:recommendation_target",
        value: classification.recommendation?.recommended_target || "",
      },
      {
        name: "ecdat:risk:classical_remediation",
        value: classification.recommendation?.classical_remediation || "",
      },
      {
        name: "ecdat:risk:pqc_migration",
        value: classification.recommendation?.pqc_migration || "",
      },
      {
        name: "ecdat:risk:explanation",
        value: classification.explanation || "",
      },
    );
  }

  // If top-level is standard CycloneDX document, update metadata properties
  if (
    annotatedBOM &&
    !Array.isArray(annotatedBOM) &&
    annotatedBOM.bomFormat === "CycloneDX"
  ) {
    annotatedBOM.metadata = annotatedBOM.metadata || {};
    annotatedBOM.metadata.properties = annotatedBOM.metadata.properties || [];
    annotatedBOM.metadata.properties = annotatedBOM.metadata.properties.filter(
      (p) => !p.name.startsWith("ecdat:risk:"),
    );
    annotatedBOM.metadata.properties.push(
      { name: "ecdat:risk:annotated_at", value: new Date().toISOString() },
      { name: "ecdat:risk:policy_profile", value: policyProfile },
      { name: "ecdat:risk:scenario", value: scenario },
      { name: "ecdat:risk:rule_version", value: ruleVersion },
    );
  }

  return {
    annotatedBOM,
    classifiedResults,
  };
}

module.exports = {
  annotateCbom,
  extractComponentCryptoDetails,
};
