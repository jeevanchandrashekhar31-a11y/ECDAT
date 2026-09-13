"""
ECDAT Crypto Dependency Mapping & Reachability Engine (Python) — Phase 3.2

Maps packages/libraries to cryptographic capabilities from the versioned knowledge base
and classifies reachability into 4 distinct, non-overstated tiers:
1. CAPABILITY_PRESENT: package contains crypto capability (manifest/SBOM)
2. TRANSIENT_IMPORT: package imports crypto package, but direct API invocation is not observed
3. DIRECT_API_CALL: application directly calls crypto API
4. RUNTIME_CONFIRMED: runtime evidence confirms crypto use

Guarantees: Reachability is never overstated (CAPABILITY_PRESENT & TRANSIENT_IMPORT => is_reachable = False).
"""

from dataclasses import dataclass, field
from enum import Enum
import json
import os
import re
from typing import Any, Dict, List, Optional, Set, Union


class ReachabilityLevel(str, Enum):
    CAPABILITY_PRESENT = "CAPABILITY_PRESENT"
    TRANSIENT_IMPORT = "TRANSIENT_IMPORT"
    DIRECT_API_CALL = "DIRECT_API_CALL"
    RUNTIME_CONFIRMED = "RUNTIME_CONFIRMED"


DEFAULT_RULES_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "rules", "crypto_dependency_mapping.json")
)


def normalize_pkg_name(name: str) -> str:
    if not name or not isinstance(name, str):
        return ""
    # Strip org scopes like @angular/ or @types/
    clean = re.sub(r"^@[^/]+/", "", name.strip().lower())
    return clean


def extract_name_from_purl(purl: str) -> str:
    if not purl or not isinstance(purl, str):
        return ""
    import urllib.parse
    stripped = re.sub(r"^pkg:[^/]+/", "", purl, flags=re.IGNORECASE)
    name_part = re.split(r"[@#?]", stripped)[0]
    return urllib.parse.unquote(name_part).lower()



@dataclass
class PackageCryptoMapping:
    package_id: str
    canonical_name: str
    aliases: List[str] = field(default_factory=list)
    ecosystems: List[str] = field(default_factory=list)
    crypto_capabilities: List[str] = field(default_factory=list)
    api_identifiers: List[str] = field(default_factory=list)
    pqc_support: str = "none"
    description: str = ""


class CryptoDependencyKnowledgeBase:
    """Loads and queries the versioned crypto dependency mapping knowledge base."""

    def __init__(self, mapping_file: Optional[str] = None):
        self.mapping_file = mapping_file or DEFAULT_RULES_PATH
        self.version = "unknown"
        self.description = ""
        self.last_updated = ""
        self.reachability_definitions: Dict[str, Dict[str, Any]] = {}
        self.packages: List[PackageCryptoMapping] = []
        self._lookup: Dict[str, PackageCryptoMapping] = {}
        self._load()

    def _load(self):
        if not os.path.exists(self.mapping_file):
            raise FileNotFoundError(f"Crypto mapping rule file not found: {self.mapping_file}")
        
        with open(self.mapping_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.version = data.get("version", "1.0.0")
        self.description = data.get("description", "")
        self.last_updated = data.get("last_updated", "")
        self.reachability_definitions = data.get("reachability_levels", {})

        for pkg in data.get("packages", []):
            mapping = PackageCryptoMapping(
                package_id=pkg["package_id"],
                canonical_name=pkg["canonical_name"],
                aliases=pkg.get("aliases", []),
                ecosystems=pkg.get("ecosystems", []),
                crypto_capabilities=pkg.get("crypto_capabilities", []),
                api_identifiers=pkg.get("api_identifiers", []),
                pqc_support=pkg.get("pqc_support", "none"),
                description=pkg.get("description", ""),
            )
            self.packages.append(mapping)
            self._lookup[mapping.canonical_name.lower()] = mapping
            self._lookup[mapping.package_id.lower()] = mapping
            for alias in mapping.aliases:
                self._lookup[alias.lower()] = mapping

    def find_package(self, identifier: str) -> Optional[PackageCryptoMapping]:
        if not identifier:
            return None
        raw = identifier.strip().lower()
        if raw in self._lookup:
            return self._lookup[raw]

        norm = normalize_pkg_name(identifier)
        if norm in self._lookup:
            return self._lookup[norm]

        purl_name = extract_name_from_purl(identifier)
        if purl_name in self._lookup:
            return self._lookup[purl_name]
        purl_base = purl_name.split("/")[-1] if purl_name else ""
        if purl_base in self._lookup:
            return self._lookup[purl_base]

        return None


@dataclass
class ReachabilityEvidence:
    in_manifest: bool = True
    imports: List[str] = field(default_factory=list)
    direct_calls: List[str] = field(default_factory=list)
    runtime_observations: List[str] = field(default_factory=list)


@dataclass
class ReachabilityClassification:
    package_name: str
    canonical_name: str
    package_id: Optional[str]
    version: str
    purl: Optional[str]
    ecosystems: List[str]
    reachability_level: ReachabilityLevel
    is_reachable: bool
    confidence: str
    crypto_capabilities: List[str]
    has_crypto_capability: bool
    pqc_support: str
    evidence: ReachabilityEvidence
    rationale: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "package_name": self.package_name,
            "canonical_name": self.canonical_name,
            "package_id": self.package_id,
            "version": self.version,
            "purl": self.purl,
            "ecosystems": self.ecosystems,
            "reachability_level": self.reachability_level.value,
            "is_reachable": self.is_reachable,
            "confidence": self.confidence,
            "crypto_capabilities": self.crypto_capabilities,
            "has_crypto_capability": self.has_crypto_capability,
            "pqc_support": self.pqc_support,
            "evidence": {
                "in_manifest": self.evidence.in_manifest,
                "imports": self.evidence.imports,
                "direct_calls": self.evidence.direct_calls,
                "runtime_observations": self.evidence.runtime_observations,
            },
            "rationale": self.rationale,
        }


class CryptoReachabilityClassifier:
    """
    Classifies package reachability and correlates dependencies against crypto knowledge base.
    Never overstates reachability.
    """

    def __init__(self, kb: Optional[CryptoDependencyKnowledgeBase] = None):
        self.kb = kb or CryptoDependencyKnowledgeBase()

    def classify(
        self,
        package_name: str,
        version: Optional[str] = None,
        purl: Optional[str] = None,
        ecosystem: Optional[str] = None,
        is_present_in_manifest: bool = True,
        imports: Optional[List[Any]] = None,
        direct_calls: Optional[List[Any]] = None,
        runtime_evidence: Optional[List[Any]] = None,
    ) -> ReachabilityClassification:
        imports = imports or []
        direct_calls = direct_calls or []
        runtime_evidence = runtime_evidence or []

        kb_entry = self.kb.find_package(purl or package_name) or self.kb.find_package(package_name)
        canonical = kb_entry.canonical_name if kb_entry else package_name
        package_id = kb_entry.package_id if kb_entry else None
        capabilities = list(kb_entry.crypto_capabilities) if kb_entry else []
        pqc_support = kb_entry.pqc_support if kb_entry else "unknown"
        ecosystems = list(kb_entry.ecosystems) if kb_entry else ([ecosystem] if ecosystem else [])

        # Filter direct calls matching known API identifiers if kb_entry exists
        verified_calls = []
        if kb_entry and kb_entry.api_identifiers:
            for c in direct_calls:
                cstr = c if isinstance(c, str) else (c.get("api") or c.get("function_name") or str(c))
                cstr_lower = cstr.lower()
                if any(api.lower() in cstr_lower or cstr_lower in api.lower() for api in kb_entry.api_identifiers):
                    verified_calls.append(cstr)
                elif isinstance(c, dict) and c.get("target_package", "").lower() in (package_name.lower(), canonical.lower()):
                    verified_calls.append(cstr)
        else:
            for c in direct_calls:
                cstr = c if isinstance(c, str) else (c.get("api") or c.get("function_name") or str(c))
                verified_calls.append(cstr)

        # Parse string imports and runtime
        import_strs = [i if isinstance(i, str) else (i.get("module") or i.get("name") or str(i)) for i in imports]
        runtime_strs = [r if isinstance(r, str) else (r.get("description") or str(r)) for r in runtime_evidence]

        # Reachability Level Resolution:
        if runtime_strs:
            level = ReachabilityLevel.RUNTIME_CONFIRMED
            is_reachable = True
            confidence = "high"
            rationale = f"Runtime telemetry/execution trace confirmed active cryptographic operation for {canonical}."
        elif verified_calls:
            level = ReachabilityLevel.DIRECT_API_CALL
            is_reachable = True
            confidence = "high"
            rationale = f"Application source code directly invokes cryptographic APIs of {canonical} ({len(verified_calls)} call site(s) identified)."
        elif import_strs:
            level = ReachabilityLevel.TRANSIENT_IMPORT
            is_reachable = False
            confidence = "low"
            rationale = f"Package {canonical} is imported in source code, but no direct cryptographic API calls were observed. Reachability is not overstated."
        elif is_present_in_manifest:
            level = ReachabilityLevel.CAPABILITY_PRESENT
            is_reachable = False
            confidence = "low"
            rationale = f"Package {canonical} contains cryptographic capabilities in dependency manifest/SBOM, but neither imports nor direct calls were detected in application code. Reachability is not overstated."
        else:
            level = ReachabilityLevel.CAPABILITY_PRESENT
            is_reachable = False
            confidence = "low"
            rationale = f"Package {canonical} not observed in active call paths."

        return ReachabilityClassification(
            package_name=package_name,
            canonical_name=canonical,
            package_id=package_id,
            version=version or "unknown",
            purl=purl,
            ecosystems=ecosystems,
            reachability_level=level,
            is_reachable=is_reachable,
            confidence=confidence,
            crypto_capabilities=capabilities,
            has_crypto_capability=len(capabilities) > 0,
            pqc_support=pqc_support,
            evidence=ReachabilityEvidence(
                in_manifest=is_present_in_manifest,
                imports=import_strs,
                direct_calls=verified_calls,
                runtime_observations=runtime_strs,
            ),
            rationale=rationale,
        )

    def correlate_dependencies(
        self,
        components: List[Dict[str, Any]],
        static_findings: Optional[List[Dict[str, Any]]] = None,
        dynamic_findings: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        static_findings = static_findings or []
        dynamic_findings = dynamic_findings or []

        correlated = []
        stats = {
            "total_dependencies_evaluated": 0,
            "crypto_packages_detected": 0,
            "reachability_breakdown": {
                ReachabilityLevel.CAPABILITY_PRESENT.value: 0,
                ReachabilityLevel.TRANSIENT_IMPORT.value: 0,
                ReachabilityLevel.DIRECT_API_CALL.value: 0,
                ReachabilityLevel.RUNTIME_CONFIRMED.value: 0,
            },
            "reachable_crypto_count": 0,
            "unreachable_crypto_count": 0,
        }

        for comp in components:
            stats["total_dependencies_evaluated"] += 1
            pkg_name = comp.get("name", "")
            purl = comp.get("purl")
            version = comp.get("version", "unknown")

            kb_entry = self.kb.find_package(purl or pkg_name) or self.kb.find_package(pkg_name)
            if not kb_entry and not comp.get("has_crypto_capability", False):
                continue

            stats["crypto_packages_detected"] += 1
            canonical = kb_entry.canonical_name if kb_entry else pkg_name

            # Match imports
            matched_imports = []
            for f in static_findings:
                tgt = str(f.get("target_package") or f.get("module") or f.get("package_name") or "").lower()
                snip = str(f.get("code_snippet") or f.get("snippet") or "").lower()
                is_import_type = (
                    f.get("type") == "import"
                    or "import " in snip
                    or "require(" in snip
                    or "from " in snip
                    or "use " in snip
                )
                matches_tgt = (
                    tgt == pkg_name.lower()
                    or tgt == canonical.lower()
                    or (kb_entry and any(tgt == a.lower() for a in kb_entry.aliases))
                    or f"import {canonical.lower()}" in snip
                    or f"require('{canonical.lower()}'" in snip
                    or f"use {canonical.lower()}" in snip
                )
                if matches_tgt and (is_import_type or not f.get("api")):
                    matched_imports.append(f)

            # Match direct calls
            matched_calls = []
            for f in static_findings:
                api = str(f.get("api") or f.get("function_name") or f.get("algorithm") or "").lower()
                tgt = str(f.get("target_package") or f.get("module") or f.get("package_name") or "").lower()
                snip = str(f.get("code_snippet") or f.get("snippet") or "").lower()

                # Exclude pure import statements without an explicit API call
                is_pure_import = (
                    (snip.startswith("import ") or snip.startswith("use ") or snip.startswith("require("))
                    and not api
                    and f.get("type") != "api_call"
                )
                if is_pure_import:
                    continue

                matches_tgt = (
                    tgt == pkg_name.lower()
                    or tgt == canonical.lower()
                    or (kb_entry and any(tgt == a.lower() for a in kb_entry.aliases))
                )
                if matches_tgt and (api or f.get("type") in ("api_call", "call")):
                    matched_calls.append(f)
                elif kb_entry and kb_entry.api_identifiers:
                    if any((api and ident.lower() in api) or (snip and ident.lower() in snip) for ident in kb_entry.api_identifiers):
                        matched_calls.append(f)

            # Match runtime
            matched_runtime = []
            for d in dynamic_findings:
                tgt = str(d.get("target_package") or d.get("module") or d.get("library") or "").lower()
                desc = str(d.get("description") or d.get("proof") or "").lower()
                if tgt == pkg_name.lower() or tgt == canonical.lower() or canonical.lower() in desc:
                    matched_runtime.append(d)

            res = self.classify(
                package_name=pkg_name,
                version=version,
                purl=purl,
                ecosystem=comp.get("ecosystem"),
                is_present_in_manifest=True,
                imports=matched_imports,
                direct_calls=matched_calls,
                runtime_evidence=matched_runtime,
            )

            stats["reachability_breakdown"][res.reachability_level.value] += 1
            if res.is_reachable:
                stats["reachable_crypto_count"] += 1
            else:
                stats["unreachable_crypto_count"] += 1

            correlated.append(res.to_dict())

        return {
            "knowledge_base_version": self.kb.version,
            "knowledge_base_description": self.kb.description,
            "summary": stats,
            "correlated_packages": correlated,
        }
