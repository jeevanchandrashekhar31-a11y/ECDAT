"""
ECDAT Robust Crypto-Library Fingerprinter (Phase 4.2)
Accumulates multi-signal evidence across shared libraries, API symbols, and internal strings.
Guarantees that a single string alone never triggers a positive cryptographic library fingerprint.
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Dict, Any, Optional, Set

from scanners.binary_container.parsers.base import CryptoIndicator, SymbolMetadata

DEFAULT_RULES_PATH = Path(__file__).resolve().parents[3] / "rules" / "crypto_library_fingerprints.json"


@dataclass
class FingerprintEvidence:
    library_id: str
    library_name: str
    confidence: str  # "high", "medium", "low", "inconclusive"
    score: float
    matched_libraries: List[str] = field(default_factory=list)
    matched_symbols: List[str] = field(default_factory=list)
    matched_strings: List[str] = field(default_factory=list)
    signal_categories: List[str] = field(default_factory=list)
    typical_capabilities: List[str] = field(default_factory=list)
    version_hint: Optional[str] = None
    rationale: str = ""

    @property
    def is_positive(self) -> bool:
        """Returns True if the evidence is robust enough to be considered a positive fingerprint."""
        return self.confidence in ("high", "medium", "low")


class LibraryFingerprinter:
    """
    Fingerprints compiled binaries against known cryptographic libraries using
    a weighted multi-signal scoring model with disambiguation.
    """

    def __init__(self, rules_path: Optional[str] = None):
        path = Path(rules_path) if rules_path else DEFAULT_RULES_PATH
        if not path.exists():
            # Fallback path for alternate execution contexts
            alt_path = Path.cwd() / "rules" / "crypto_library_fingerprints.json"
            if alt_path.exists():
                path = alt_path

        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                self.rules_data = json.load(f)
        else:
            self.rules_data = {"libraries": [], "scoring_weights": {}}

        self.scoring = self.rules_data.get(
            "scoring_weights",
            {
                "library_match": 35,
                "symbol_match": 25,
                "string_match": 10,
                "high_confidence_threshold": 50,
                "medium_confidence_threshold": 30,
                "low_confidence_threshold": 20,
            },
        )
        self.libraries = self.rules_data.get("libraries", [])

    def fingerprint(
        self,
        imported_libraries: List[str],
        symbols: List[SymbolMetadata],
        strings: List[str],
    ) -> List[FingerprintEvidence]:
        """
        Evaluates binary metadata against all library fingerprints.
        Returns positive fingerprint matches sorted by score.
        """
        symbol_names = [s.name for s in symbols]
        raw_matches: Dict[str, FingerprintEvidence] = {}

        for lib_def in self.libraries:
            evidence = self._evaluate_library(lib_def, imported_libraries, symbol_names, strings)
            if evidence:
                raw_matches[evidence.library_id] = evidence

        # Disambiguate competing libraries (e.g. BoringSSL / LibreSSL vs OpenSSL)
        disambiguated = self._disambiguate(raw_matches)

        # Filter out inconclusive results (e.g. single-string matches)
        positive_results = [ev for ev in disambiguated.values() if ev.is_positive]
        positive_results.sort(key=lambda x: x.score, reverse=True)
        return positive_results

    def _evaluate_library(
        self,
        lib_def: Dict[str, Any],
        imported_libraries: List[str],
        symbols: List[str],
        strings: List[str],
    ) -> Optional[FingerprintEvidence]:
        lib_id = lib_def["id"]
        lib_name = lib_def["name"]
        thresholds = lib_def.get("thresholds", {})
        min_strings_without_symbols = thresholds.get("min_strings_without_symbols", 2)

        matched_libs: List[str] = []
        matched_syms: List[str] = []
        matched_strs: List[str] = []
        signal_categories: Set[str] = set()
        score = 0.0

        # 1. Match imported libraries
        for imp_lib in imported_libraries:
            imp_clean = imp_lib.lower()
            for pattern in lib_def.get("library_patterns", []):
                if re.search(pattern, imp_clean, re.IGNORECASE):
                    if imp_lib not in matched_libs:
                        matched_libs.append(imp_lib)
                        score += self.scoring.get("library_match", 35)
                        signal_categories.add("LIBRARY")
                    break

        # 2. Match symbols
        for sym in symbols:
            for sig in lib_def.get("symbol_signatures", []):
                pat = sig["pattern"]
                kind = sig.get("kind", "exact")
                weight = sig.get("weight", self.scoring.get("symbol_match", 25))

                matched = False
                if kind == "exact" and sym == pat:
                    matched = True
                elif kind == "prefix" and (sym.startswith(pat) or f"::{pat}" in sym):
                    matched = True
                elif kind == "regex" and re.search(pat, sym):
                    matched = True

                if matched:
                    if sym not in matched_syms:
                        matched_syms.append(sym)
                        # Cap symbol score additions to avoid runaway on large binaries
                        if len(matched_syms) <= 4:
                            score += weight
                        signal_categories.add("SYMBOL")
                    break

        # 3. Match distinctive strings
        for s in strings:
            for str_sig in lib_def.get("distinctive_strings", []):
                pat = str_sig["pattern"]
                kind = str_sig.get("kind", "substring")
                weight = str_sig.get("weight", self.scoring.get("string_match", 10))

                matched = False
                if kind == "substring" and pat.lower() in s.lower():
                    matched = True
                elif kind == "exact" and pat.strip() == s.strip():
                    matched = True
                elif kind == "regex" and re.search(pat, s, re.IGNORECASE):
                    matched = True

                if matched:
                    if s not in matched_strs:
                        matched_strs.append(s)
                        if len(matched_strs) <= 5:
                            score += weight
                        signal_categories.add("STRING")
                    break

        # Total absence of evidence
        if not signal_categories:
            return None

        # CRITICAL INVARIANT: Never fingerprint by one string alone
        if signal_categories == {"STRING"} and len(matched_strs) < min_strings_without_symbols:
            return FingerprintEvidence(
                library_id=lib_id,
                library_name=lib_name,
                confidence="inconclusive",
                score=score,
                matched_libraries=matched_libs,
                matched_symbols=matched_syms,
                matched_strings=matched_strs,
                signal_categories=list(signal_categories),
                typical_capabilities=lib_def.get("typical_capabilities", []),
                rationale=f"Rejected: Single string match '{matched_strs[0]}' is insufficient for robust fingerprinting.",
            )

        # Determine confidence based on multi-signal evidence
        confidence = "low"
        high_thresh = self.scoring.get("high_confidence_threshold", 50)
        med_thresh = self.scoring.get("medium_confidence_threshold", 30)

        # High confidence requires at least 2 distinct signal categories or strong symbol presence
        if len(signal_categories) >= 2 and score >= high_thresh:
            confidence = "high"
        elif len(matched_syms) >= 2 and score >= high_thresh:
            confidence = "high"
        elif signal_categories == {"STRING"}:
            confidence = "low"
        elif score >= med_thresh or matched_libs or len(matched_syms) >= 1:
            confidence = "medium"
        elif len(matched_strs) >= min_strings_without_symbols:
            confidence = "low"
        else:
            confidence = "inconclusive"

        # Try to extract version hint from strings
        version_hint = self._extract_version_hint(lib_id, matched_strs)

        rationale_parts = []
        if matched_libs:
            rationale_parts.append(f"{len(matched_libs)} library names linked ({', '.join(matched_libs[:3])})")
        if matched_syms:
            rationale_parts.append(f"{len(matched_syms)} symbols matched ({', '.join(matched_syms[:3])})")
        if matched_strs:
            rationale_parts.append(f"{len(matched_strs)} distinctive strings identified")
        rationale = f"Multi-signal evidence: {'; '.join(rationale_parts)}."

        return FingerprintEvidence(
            library_id=lib_id,
            library_name=lib_name,
            confidence=confidence,
            score=score,
            matched_libraries=matched_libs,
            matched_symbols=matched_syms,
            matched_strings=matched_strs,
            signal_categories=sorted(list(signal_categories)),
            typical_capabilities=lib_def.get("typical_capabilities", []),
            version_hint=version_hint,
            rationale=rationale,
        )

    def _disambiguate(self, matches: Dict[str, FingerprintEvidence]) -> Dict[str, FingerprintEvidence]:
        """
        Resolves lineage ambiguities between related libraries (e.g. OpenSSL vs BoringSSL vs LibreSSL).
        """
        # If BoringSSL has positive evidence, demote or eliminate generic OpenSSL unless OpenSSL has exclusive markers
        if "boringssl" in matches and matches["boringssl"].is_positive:
            if "openssl" in matches:
                openssl_ev = matches["openssl"]
                # Check if OpenSSL has exclusive symbols that BoringSSL lacks
                has_exclusive_openssl = any(
                    s in openssl_ev.matched_symbols
                    for s in ["OSSL_PROVIDER_load", "OpenSSL_version", "OPENSSL_init_crypto"]
                )
                if not has_exclusive_openssl:
                    openssl_ev.confidence = "inconclusive"
                    openssl_ev.rationale = "Demoted: BoringSSL signatures superseding generic OpenSSL lineage."

        # If LibreSSL has positive evidence, demote generic OpenSSL
        if "libressl" in matches and matches["libressl"].is_positive:
            if "openssl" in matches:
                openssl_ev = matches["openssl"]
                has_exclusive_openssl = any(
                    s in openssl_ev.matched_symbols for s in ["OSSL_PROVIDER_load", "OpenSSL_version"]
                )
                if not has_exclusive_openssl:
                    openssl_ev.confidence = "inconclusive"
                    openssl_ev.rationale = "Demoted: LibreSSL signatures superseding generic OpenSSL lineage."

        return matches

    def _extract_version_hint(self, lib_id: str, strings: List[str]) -> Optional[str]:
        for s in strings:
            if lib_id == "openssl":
                m = re.search(r"OpenSSL\s+([0-9]+\.[0-9]+\.[0-9]+[a-z]*)", s, re.IGNORECASE)
                if m:
                    return m.group(1)
            elif lib_id == "libressl":
                m = re.search(r"LibreSSL\s+([0-9]+\.[0-9]+\.[0-9]+)", s, re.IGNORECASE)
                if m:
                    return m.group(1)
            elif lib_id == "botan":
                m = re.search(r"Botan\s+([0-9]+\.[0-9]+\.[0-9]+)", s, re.IGNORECASE)
                if m:
                    return m.group(1)
            elif lib_id == "wolfssl":
                m = re.search(r"wolfSSL\s+(?:version\s+)?([0-9]+\.[0-9]+\.[0-9]+)", s, re.IGNORECASE)
                if m:
                    return m.group(1)
        return None
