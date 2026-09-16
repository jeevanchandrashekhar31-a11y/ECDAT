/**
 * ECDAT Crypto Reachability & Dependency Mapping Engine
 * 
 * Maps packages/libraries to cryptographic capabilities from a versioned knowledge base
 * and classifies reachability into 4 distinct, non-overstated tiers:
 * 1. CAPABILITY_PRESENT: package contains crypto capability in dependencies / SBOM
 * 2. TRANSIENT_IMPORT: package imports crypto package, but direct API invocation is not observed
 * 3. DIRECT_API_CALL: application directly calls crypto API
 * 4. RUNTIME_CONFIRMED: runtime evidence confirms active crypto use
 * 
 * Guarantees: Reachability is never overstated (CAPABILITY_PRESENT & TRANSIENT_IMPORT => is_reachable = false).
 */

const { getRules } = require("../risk_engine/rules_loader");
const { CryptoReachabilityLevel, ConfidenceLevel } = require("../domain/contracts");

/**
 * Normalizes package name for comparison.
 */
function normalizePkgName(name) {
  if (!name || typeof name !== "string") return "";
  return name.trim().toLowerCase().replace(/^@[^/]+\//, "");
}

/**
 * Normalizes a package URL (purl) or purl-like identifier.
 */
function extractNameFromPurl(purl) {
  if (!purl || typeof purl !== "string") return "";
  // pkg:npm/%40angular/animation@12.3.1 -> @angular/animation
  // pkg:golang/golang.org/x/crypto@v0.14.0 -> golang.org/x/crypto
  // pkg:cargo/rustls@0.21.0 -> rustls
  const stripped = purl.replace(/^pkg:[^/]+\//i, "");
  const namePart = stripped.split(/[@#?]/)[0];
  return decodeURIComponent(namePart).toLowerCase();
}

/**
 * Finds a package definition in the crypto dependency mapping knowledge base.
 */
function findPackageInKnowledgeBase(pkgIdentifier, mappingRules) {
  if (!pkgIdentifier || !mappingRules || !Array.isArray(mappingRules.packages)) {
    return null;
  }

  const raw = String(pkgIdentifier).trim();
  const normalized = normalizePkgName(raw);
  const purlExtracted = extractNameFromPurl(raw);
  const purlBase = purlExtracted ? purlExtracted.split("/").pop() : "";

  // Pass 1: Exact matches on package_id or canonical_name
  for (const pkg of mappingRules.packages) {
    const pkgId = (pkg.package_id || "").toLowerCase();
    const can = (pkg.canonical_name || "").toLowerCase();

    if (pkgId && (pkgId === raw.toLowerCase() || pkgId === normalized || pkgId === purlExtracted)) {
      return pkg;
    }
    if (can && (can === raw.toLowerCase() || can === normalized || can === purlExtracted)) {
      return pkg;
    }
  }

  // Pass 2: Exact matches on aliases
  for (const pkg of mappingRules.packages) {
    if (Array.isArray(pkg.aliases)) {
      for (const alias of pkg.aliases) {
        const al = alias.toLowerCase();
        if (al === raw.toLowerCase() || al === normalized || al === purlExtracted) {
          return pkg;
        }
      }
    }
  }

  // Pass 3: Fallback on purlBase
  if (purlBase && purlBase !== raw.toLowerCase()) {
    for (const pkg of mappingRules.packages) {
      const can = (pkg.canonical_name || "").toLowerCase();
      if (can === purlBase) {
        return pkg;
      }
      if (Array.isArray(pkg.aliases)) {
        for (const alias of pkg.aliases) {
          if (alias.toLowerCase() === purlBase) {
            return pkg;
          }
        }
      }
    }
  }

  return null;
}

/**
 * Classifies the reachability level of a package given its presence, imports,
 * static API calls, and runtime evidence.
 * 
 * Strict reachability principle:
 * - CAPABILITY_PRESENT -> reachable: false
 * - TRANSIENT_IMPORT   -> reachable: false
 * - DIRECT_API_CALL    -> reachable: true
 * - RUNTIME_CONFIRMED  -> reachable: true
 * 
 * @param {object} params
 * @param {string} params.packageName
 * @param {string} [params.version]
 * @param {string} [params.purl]
 * @param {string} [params.ecosystem]
 * @param {boolean} [params.isPresentInManifest=true]
 * @param {Array<string|object>} [params.imports=[]]
 * @param {Array<string|object>} [params.directCalls=[]]
 * @param {Array<string|object>} [params.runtimeEvidence=[]]
 * @param {object} [params.customMappingRules=null]
 * @returns {object} Correlated reachability result
 */
function classifyReachability({
  packageName,
  version = null,
  purl = null,
  ecosystem = null,
  isPresentInManifest = true,
  imports = [],
  directCalls = [],
  runtimeEvidence = [],
  customMappingRules = null,
}) {
  const rules = customMappingRules || getRules().crypto_dependency_mapping;
  const kbEntry = findPackageInKnowledgeBase(purl || packageName, rules) || findPackageInKnowledgeBase(packageName, rules);

  const capabilities = kbEntry ? [...kbEntry.crypto_capabilities] : [];
  const canonicalName = kbEntry ? kbEntry.canonical_name : packageName;
  const registeredEcosystems = kbEntry ? kbEntry.ecosystems : (ecosystem ? [ecosystem] : []);

  // Filter direct calls that match the package's known API identifiers if kbEntry exists
  let verifiedDirectCalls = [...directCalls];
  if (kbEntry && Array.isArray(kbEntry.api_identifiers) && directCalls.length > 0) {
    verifiedDirectCalls = directCalls.filter((call) => {
      const callStr = typeof call === "string" ? call : (call.api || call.function_name || call.name || "");
      return kbEntry.api_identifiers.some((apiId) =>
        callStr.toLowerCase().includes(apiId.toLowerCase()) ||
        apiId.toLowerCase().includes(callStr.toLowerCase())
      );
    });
    // If no direct API matched kbEntry's known API identifiers but directCalls were explicitly passed with targetPackage matching
    const isMatchingTarget = (c) => {
      const tgt = (typeof c === "object" && c !== null ? (c.target_package || c.targetPackage || c.module || c.package_name || "") : "").toLowerCase();
      return tgt === packageName.toLowerCase() || tgt === canonicalName.toLowerCase();
    };
    if (verifiedDirectCalls.length === 0 && directCalls.some(isMatchingTarget)) {
      verifiedDirectCalls = directCalls.filter(isMatchingTarget);
    }
  }

  // 1. Determine reachability level
  let reachabilityLevel;
  let isReachable;
  let confidence;
  let rationale;

  if (runtimeEvidence && runtimeEvidence.length > 0) {
    reachabilityLevel = CryptoReachabilityLevel.RUNTIME_CONFIRMED;
    isReachable = true;
    confidence = ConfidenceLevel.HIGH;
    rationale = `Runtime telemetry/execution trace confirmed active cryptographic operation for ${canonicalName}.`;
  } else if (verifiedDirectCalls.length > 0) {
    reachabilityLevel = CryptoReachabilityLevel.DIRECT_API_CALL;
    isReachable = true;
    confidence = ConfidenceLevel.HIGH;
    rationale = `Application source code directly invokes cryptographic APIs of ${canonicalName} (${verifiedDirectCalls.length} call site(s) identified).`;
  } else if (imports && imports.length > 0) {
    reachabilityLevel = CryptoReachabilityLevel.TRANSIENT_IMPORT;
    isReachable = false;
    confidence = ConfidenceLevel.LOW;
    rationale = `Package ${canonicalName} is imported in source code, but no direct cryptographic API calls were observed. Reachability is not overstated.`;
  } else if (isPresentInManifest) {
    reachabilityLevel = CryptoReachabilityLevel.CAPABILITY_PRESENT;
    isReachable = false;
    confidence = ConfidenceLevel.LOW;
    rationale = `Package ${canonicalName} contains cryptographic capabilities in dependency manifest/SBOM, but neither imports nor direct calls were detected in application code. Reachability is not overstated.`;
  } else {
    reachabilityLevel = "UNKNOWN";
    isReachable = false;
    confidence = ConfidenceLevel.LOW;
    rationale = `Package ${canonicalName} was not found in manifest, imports, or call sites.`;
  }

  return {
    package_name: packageName,
    canonical_name: canonicalName,
    package_id: kbEntry ? kbEntry.package_id : null,
    version: version || "unknown",
    purl: purl || null,
    ecosystems: registeredEcosystems,
    reachability_level: reachabilityLevel,
    is_reachable: isReachable,
    confidence,
    crypto_capabilities: capabilities,
    has_crypto_capability: capabilities.length > 0,
    pqc_support: kbEntry ? (kbEntry.pqc_support || "none") : "unknown",
    evidence: {
      in_manifest: isPresentInManifest,
      imports: imports.map(i => (typeof i === "string" ? i : (i.module || i.name || JSON.stringify(i)))),
      direct_calls: verifiedDirectCalls.map(c => (typeof c === "string" ? c : (c.api || c.function_name || JSON.stringify(c)))),
      runtime_observations: runtimeEvidence.map(r => (typeof r === "string" ? r : (r.description || JSON.stringify(r)))),
    },
    rationale,
  };
}

/**
 * Correlates SBOM components, static AST findings, and dynamic findings
 * into a complete cryptographic dependency reachability assessment.
 * 
 * @param {object} params
 * @param {Array<object>} [params.components=[]] Ingested SBOM / manifest components
 * @param {Array<object>} [params.staticFindings=[]] Static AST findings (imports, calls, algorithm usage)
 * @param {Array<object>} [params.dynamicFindings=[]] Dynamic or runtime findings
 * @param {string} [params.rulesDir]
 * @returns {object} Comprehensive correlation report
 */
function correlateCryptoDependencies({
  components = [],
  staticFindings = [],
  dynamicFindings = [],
  rulesDir = null,
}) {
  const rules = getRules(rulesDir || undefined).crypto_dependency_mapping;

  const correlatedPackages = [];
  const stats = {
    total_dependencies_evaluated: 0,
    crypto_packages_detected: 0,
    reachability_breakdown: {
      [CryptoReachabilityLevel.CAPABILITY_PRESENT]: 0,
      [CryptoReachabilityLevel.TRANSIENT_IMPORT]: 0,
      [CryptoReachabilityLevel.DIRECT_API_CALL]: 0,
      [CryptoReachabilityLevel.RUNTIME_CONFIRMED]: 0,
    },
    reachable_crypto_count: 0,
    unreachable_crypto_count: 0,
  };

  for (const comp of components) {
    stats.total_dependencies_evaluated += 1;
    const pkgName = comp.name;
    const purl = comp.purl;
    const version = comp.version;

    // Check if this package has known crypto capabilities
    const kbEntry = findPackageInKnowledgeBase(purl || pkgName, rules) || findPackageInKnowledgeBase(pkgName, rules);
    if (!kbEntry && !comp.has_crypto_capability) {
      continue; // Non-crypto component, continue
    }

    stats.crypto_packages_detected += 1;
    const canonical = kbEntry ? kbEntry.canonical_name : pkgName;

    // Search for imports matching this package
    const matchedImports = staticFindings.filter(f => {
      const target = (f.target_package || f.module || f.library || f.package_name || "").toLowerCase();
      const codeSnippet = (f.code_snippet || f.snippet || "").toLowerCase();
      const isImportType = f.type === "import" || codeSnippet.includes("import ") || codeSnippet.includes("require(") || codeSnippet.includes("from ") || codeSnippet.includes("use ");
      const matchesTarget = (
        target === pkgName.toLowerCase() ||
        target === canonical.toLowerCase() ||
        (kbEntry && kbEntry.aliases && kbEntry.aliases.some(a => target === a.toLowerCase())) ||
        codeSnippet.includes(`import ${canonical.toLowerCase()}`) ||
        codeSnippet.includes(`require('${canonical.toLowerCase()}'`) ||
        codeSnippet.includes(`from ${canonical.toLowerCase()}`) ||
        codeSnippet.includes(`use ${canonical.toLowerCase()}`)
      );
      return matchesTarget && (isImportType || !f.api);
    });

    // Search for direct API calls matching this package
    const matchedCalls = staticFindings.filter(f => {
      const api = (f.api || f.function_name || f.algorithm || "").toLowerCase();
      const target = (f.target_package || f.module || f.package_name || "").toLowerCase();
      const codeSnippet = (f.code_snippet || f.snippet || "").toLowerCase();

      // Exclude pure import statements without an explicit API call
      const isPureImport = (codeSnippet.startsWith("import ") || codeSnippet.startsWith("use ") || codeSnippet.startsWith("require(")) && !api && f.type !== "api_call";
      if (isPureImport) {
        return false;
      }

      const matchesTarget = target === pkgName.toLowerCase() || target === canonical.toLowerCase() ||
        (kbEntry && kbEntry.aliases && kbEntry.aliases.some(a => target === a.toLowerCase()));

      if (matchesTarget && (api || f.type === "api_call" || f.type === "call")) {
        return true;
      }
      if (kbEntry && Array.isArray(kbEntry.api_identifiers)) {
        return kbEntry.api_identifiers.some(id => 
          (api && api.includes(id.toLowerCase())) || (codeSnippet && codeSnippet.includes(id.toLowerCase()))
        );
      }
      return false;
    });

    // Search for runtime evidence matching this package
    const matchedRuntime = dynamicFindings.filter(d => {
      const target = (d.target_package || d.module || d.library || "").toLowerCase();
      const desc = (d.description || d.proof || "").toLowerCase();
      return (
        target === pkgName.toLowerCase() ||
        target === canonical.toLowerCase() ||
        desc.includes(canonical.toLowerCase())
      );
    });

    const classification = classifyReachability({
      packageName: pkgName,
      version,
      purl,
      ecosystem: comp.ecosystem || null,
      isPresentInManifest: true,
      imports: matchedImports,
      directCalls: matchedCalls,
      runtimeEvidence: matchedRuntime,
      customMappingRules: rules,
    });

    stats.reachability_breakdown[classification.reachability_level] =
      (stats.reachability_breakdown[classification.reachability_level] || 0) + 1;

    if (classification.is_reachable) {
      stats.reachable_crypto_count += 1;
    } else {
      stats.unreachable_crypto_count += 1;
    }

    correlatedPackages.push(classification);
  }

  return {
    version: rules.version,
    knowledge_base_description: rules.description,
    summary: stats,
    correlated_packages: correlatedPackages,
  };
}

module.exports = {
  findPackageInKnowledgeBase,
  classifyReachability,
  correlateCryptoDependencies,
  normalizePkgName,
  extractNameFromPurl,
};
