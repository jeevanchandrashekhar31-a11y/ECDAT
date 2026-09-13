/**
 * Correlation Subsystem Boundary
 * Responsible for linking findings to parent assets, constructing AssetRelationships,
 * and performing asset-level deduplication.
 */

const { AssetRelationship, RelationshipType } = require("../domain/contracts");

/**
 * Correlates a list of findings and components to their parent assets,
 * generating directed domain AssetRelationships and deduplicated asset records.
 * @param {Array<object>} rawComponents
 * @param {Array<object>} findings
 * @returns {{ relationships: Array<AssetRelationship>, assetMap: Map<string, object> }}
 */
function correlateAssetsAndFindings(rawComponents = [], findings = []) {
  const relationships = [];
  const assetMap = new Map();

  for (const f of findings) {
    const assetId = String(f.asset_id || f.bom_ref || "global");
    if (!assetMap.has(assetId)) {
      assetMap.set(assetId, {
        assetId,
        findings: [],
        components: new Set(),
      });
    }
    const assetRecord = assetMap.get(assetId);
    assetRecord.findings.push(f);

    if (f.bom_ref && f.bom_ref !== assetId) {
      assetRecord.components.add(f.bom_ref);
      relationships.push(
        new AssetRelationship({
          sourceId: assetId,
          targetId: f.bom_ref,
          relationshipType: RelationshipType.CONTAINS,
        }),
      );
    }
  }

  // Correlate component dependencies from raw CBOM dependencies if present
  for (const comp of rawComponents) {
    if (comp.dependencies && Array.isArray(comp.dependencies)) {
      for (const depRef of comp.dependencies) {
        relationships.push(
          new AssetRelationship({
            sourceId: comp.bom_ref || comp.name,
            targetId: depRef,
            relationshipType: RelationshipType.DEPENDS_ON,
          }),
        );
      }
    }
  }

  return {
    relationships,
    assetMap,
  };
}

const {
  findPackageInKnowledgeBase,
  classifyReachability,
  correlateCryptoDependencies,
} = require("./reachability");

const {
  correlateDependencyVulnerabilities,
  calculateRiskContribution,
  assessExploitability,
  isVersionAffected,
} = require("./vulnerability_correlator");

module.exports = {
  correlateAssetsAndFindings,
  findPackageInKnowledgeBase,
  classifyReachability,
  correlateCryptoDependencies,
  correlateDependencyVulnerabilities,
  calculateRiskContribution,
  assessExploitability,
  isVersionAffected,
};


