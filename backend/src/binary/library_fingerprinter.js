/**
 * ECDAT Robust Crypto-Library Fingerprinter (Node.js) — Phase 4.2
 * Fingerprints binaries and artifacts against 10 crypto libraries using multi-signal evidence.
 * Invariant: Never fingerprint by one string alone.
 */

const path = require("path");
const fs = require("fs");
const { loadAndValidateAllRules } = require("../risk_engine/rules_loader");

class LibraryFingerprinter {
  constructor(customRules = null) {
    if (customRules) {
      this.rules = customRules;
    } else {
      try {
        const allRules = loadAndValidateAllRules();
        this.rules = allRules.crypto_library_fingerprints;
      } catch {
        const defaultPath = path.resolve(__dirname, "../../../rules/crypto_library_fingerprints.json");
        this.rules = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
      }
    }

    this.scoring = this.rules.scoring_weights || {
      library_match: 35,
      symbol_match: 25,
      string_match: 10,
      high_confidence_threshold: 50,
      medium_confidence_threshold: 30,
      low_confidence_threshold: 20,
    };
    this.libraries = this.rules.libraries || [];
  }

  fingerprint(importedLibraries = [], symbols = [], strings = []) {
    const symbolNames = symbols.map((s) => (typeof s === "string" ? s : s.name));
    const rawMatches = new Map();

    for (const libDef of this.libraries) {
      const ev = this._evaluateLibrary(libDef, importedLibraries, symbolNames, strings);
      if (ev) {
        rawMatches.set(ev.library_id, ev);
      }
    }

    // Disambiguate competing lineages
    this._disambiguate(rawMatches);

    // Return only positive fingerprints
    const positive = Array.from(rawMatches.values()).filter((ev) => ev.is_positive);
    positive.sort((a, b) => b.score - a.score);
    return positive;
  }

  _evaluateLibrary(libDef, importedLibraries, symbols, strings) {
    const libId = libDef.id;
    const libName = libDef.name;
    const thresholds = libDef.thresholds || {};
    const minStrings = thresholds.min_strings_without_symbols || 2;

    const matchedLibs = [];
    const matchedSyms = [];
    const matchedStrs = [];
    const signalCategories = new Set();
    let score = 0;

    // 1. Libraries
    for (const impLib of importedLibraries) {
      for (const pattern of libDef.library_patterns || []) {
        const regex = new RegExp(pattern, "i");
        if (regex.test(impLib)) {
          if (!matchedLibs.includes(impLib)) {
            matchedLibs.push(impLib);
            score += this.scoring.library_match || 35;
            signalCategories.add("LIBRARY");
          }
          break;
        }
      }
    }

    // 2. Symbols
    for (const sym of symbols) {
      for (const sig of libDef.symbol_signatures || []) {
        const pat = sig.pattern;
        const kind = sig.kind || "exact";
        const weight = sig.weight || this.scoring.symbol_match || 25;

        let matched = false;
        if (kind === "exact" && sym === pat) {
          matched = true;
        } else if (kind === "prefix" && (sym.startsWith(pat) || sym.includes(`::${pat}`))) {
          matched = true;
        } else if (kind === "regex" && new RegExp(pat).test(sym)) {
          matched = true;
        }

        if (matched) {
          if (!matchedSyms.includes(sym)) {
            matchedSyms.push(sym);
            if (matchedSyms.length <= 4) score += weight;
            signalCategories.add("SYMBOL");
          }
          break;
        }
      }
    }

    // 3. Strings
    for (const s of strings) {
      for (const strSig of libDef.distinctive_strings || []) {
        const pat = strSig.pattern;
        const kind = strSig.kind || "substring";
        const weight = strSig.weight || this.scoring.string_match || 10;

        let matched = false;
        if (kind === "substring" && s.toLowerCase().includes(pat.toLowerCase())) {
          matched = true;
        } else if (kind === "exact" && s.trim() === pat.trim()) {
          matched = true;
        } else if (kind === "regex" && new RegExp(pat, "i").test(s)) {
          matched = true;
        }

        if (matched) {
          if (!matchedStrs.includes(s)) {
            matchedStrs.push(s);
            if (matchedStrs.length <= 5) score += weight;
            signalCategories.add("STRING");
          }
          break;
        }
      }
    }

    if (signalCategories.size === 0) {
      return null;
    }

    // CRITICAL INVARIANT: Reject single-string match
    if (signalCategories.size === 1 && signalCategories.has("STRING") && matchedStrs.length < minStrings) {
      return {
        library_id: libId,
        library_name: libName,
        confidence: "inconclusive",
        score,
        matched_libraries: matchedLibs,
        matched_symbols: matchedSyms,
        matched_strings: matchedStrs,
        signal_categories: Array.from(signalCategories),
        typical_capabilities: libDef.typical_capabilities || [],
        is_positive: false,
        rationale: `Rejected: Single string match '${matchedStrs[0]}' is insufficient for robust fingerprinting.`,
      };
    }

    // Determine confidence
    let confidence = "low";
    const highThresh = this.scoring.high_confidence_threshold || 50;
    const medThresh = this.scoring.medium_confidence_threshold || 30;

    if (signalCategories.size >= 2 && score >= highThresh) {
      confidence = "high";
    } else if (matchedSyms.length >= 2 && score >= highThresh) {
      confidence = "high";
    } else if (signalCategories.size === 1 && signalCategories.has("STRING")) {
      confidence = "low";
    } else if (score >= medThresh || matchedLibs.length >= 1 || matchedSyms.length >= 1) {
      confidence = "medium";
    } else if (matchedStrs.length >= minStrings) {
      confidence = "low";
    } else {
      confidence = "inconclusive";
    }

    return {
      library_id: libId,
      library_name: libName,
      confidence,
      score,
      matched_libraries: matchedLibs,
      matched_symbols: matchedSyms,
      matched_strings: matchedStrs,
      signal_categories: Array.from(signalCategories).sort(),
      typical_capabilities: libDef.typical_capabilities || [],
      is_positive: ["high", "medium", "low"].includes(confidence),
      rationale: `Multi-signal evidence: ${matchedLibs.length} libs, ${matchedSyms.length} syms, ${matchedStrs.length} strings.`,
    };
  }

  _disambiguate(matches) {
    if (matches.has("boringssl") && matches.get("boringssl").is_positive) {
      if (matches.has("openssl")) {
        const openssl = matches.get("openssl");
        const hasExclusive = (openssl.matched_symbols || []).some((s) =>
          ["OSSL_PROVIDER_load", "OpenSSL_version", "OPENSSL_init_crypto"].includes(s)
        );
        if (!hasExclusive) {
          openssl.confidence = "inconclusive";
          openssl.is_positive = false;
          openssl.rationale = "Demoted: BoringSSL signatures superseding generic OpenSSL lineage.";
        }
      }
    }

    if (matches.has("libressl") && matches.get("libressl").is_positive) {
      if (matches.has("openssl")) {
        const openssl = matches.get("openssl");
        const hasExclusive = (openssl.matched_symbols || []).some((s) =>
          ["OSSL_PROVIDER_load", "OpenSSL_version"].includes(s)
        );
        if (!hasExclusive) {
          openssl.confidence = "inconclusive";
          openssl.is_positive = false;
          openssl.rationale = "Demoted: LibreSSL signatures superseding generic OpenSSL lineage.";
        }
      }
    }
  }
}

module.exports = {
  LibraryFingerprinter,
};
