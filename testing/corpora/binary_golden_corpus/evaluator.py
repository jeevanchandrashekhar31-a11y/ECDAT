"""
ECDAT Binary & Container Golden Corpus Evaluator (Phase 30 / P2)

Evaluates binary/container scanner accuracy and performance against standard binary targets:
- Calculates:
  - Precision: TP / (TP + FP)
  - Recall: TP / (TP + FN)
  - F1 Score: 2 * (Precision * Recall) / (Precision + Recall)
  - False Positives (FP)
  - False Negatives (FN)
  - True Negatives (TN)
  - Scan Wall Time (seconds)
  - Peak Memory (MB)
- Evaluates library identification across:
  1. OpenSSL binaries
  2. mbedTLS binaries
  3. wolfSSL binaries
  4. Clean libc binaries (negative controls)
- Generates a comprehensive markdown benchmark report strictly FROM test execution, never typed by hand.
"""

import json
import os
import struct
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scanners.binary_container.parsers import analyze_binary, LibraryFingerprinter
from scanners.common.resource_monitor import ResourceMonitor, ResourceMetrics


def synthesize_elf_binary(needed_libs: List[str], symbols: List[str], strings_content: str) -> bytes:
    """
    Synthesizes a valid 64-bit ELF binary containing the specified dynamic library dependencies,
    exported/imported symbols in .dynsym, and text section strings.
    """
    shstrtab = b"\x00.shstrtab\x00.dynstr\x00.dynamic\x00.dynsym\x00.text\x00"

    dynstr = b"\x00"
    lib_offsets = []
    for lib in needed_libs:
        lib_offsets.append(len(dynstr))
        dynstr += lib.encode("utf-8") + b"\x00"

    sym_offsets = []
    for sym in symbols:
        sym_offsets.append(len(dynstr))
        dynstr += sym.encode("utf-8") + b"\x00"

    header_size = 64
    text_data = b"\x90\x90\x90" + strings_content.encode("utf-8") + b"\x00"
    text_offset = header_size
    text_size = len(text_data)

    shstr_offset = text_offset + text_size
    shstr_size = len(shstrtab)

    dynstr_offset = shstr_offset + shstr_size
    dynstr_size = len(dynstr)

    dynamic_data = b""
    for off in lib_offsets:
        dynamic_data += struct.pack("<qQ", 1, off)  # DT_NEEDED
    dynamic_data += struct.pack("<qQ", 0, 0)  # DT_NULL
    dynamic_offset = dynstr_offset + dynstr_size
    dynamic_size = len(dynamic_data)

    sym0 = struct.pack("<IBBHQQ", 0, 0, 0, 0, 0, 0)
    dynsym_data = sym0
    for idx, off in enumerate(sym_offsets):
        dynsym_data += struct.pack("<IBBHQQ", off, 0x12, 0, 0, 0x401000 + (idx * 16), 16)
    dynsym_offset = dynamic_offset + dynamic_size
    dynsym_size = len(dynsym_data)

    shoff = dynsym_offset + dynsym_size

    sh_null = struct.pack("<IIQQQQIIQQ", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    sh_text = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".text"), 1, 6, 0x401000, text_offset, text_size, 0, 0, 16, 0)
    sh_shstr = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".shstrtab"), 3, 0, 0, shstr_offset, shstr_size, 0, 0, 1, 0)
    sh_dynstr = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".dynstr"), 3, 2, 0, dynstr_offset, dynstr_size, 0, 0, 1, 0)
    sh_dynamic = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".dynamic"), 6, 3, 0, dynamic_offset, dynamic_size, 3, 0, 8, 16)
    sh_dynsym = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".dynsym"), 11, 2, 0, dynsym_offset, dynsym_size, 3, 1, 8, 24)

    shdrs = sh_null + sh_text + sh_shstr + sh_dynstr + sh_dynamic + sh_dynsym
    e_ident = b"\x7fELF\x02\x01\x01\x00" + (b"\x00" * 8)
    elf_hdr = struct.pack("<16sHHIQQQIHHHHHH", e_ident, 2, 0x3E, 1, 0x401000, 0, shoff, 0, 64, 0, 0, 64, 6, 2)
    return elf_hdr + text_data + shstrtab + dynstr + dynamic_data + dynsym_data + shdrs


class BinaryGoldenCorpusEvaluator:
    """
    Evaluates Binary/Container scanner accuracy against ground-truth ELF binary fixtures.
    """

    def __init__(self, corpus_dir: Optional[Path] = None, manifest_path: Optional[Path] = None):
        self.corpus_dir = (corpus_dir or Path(__file__).parent).resolve()
        self.manifest_path = (manifest_path or (self.corpus_dir / "manifest.json")).resolve()
        self.fingerprinter = LibraryFingerprinter()
        self._ensure_fixtures()

    def _ensure_fixtures(self) -> None:
        """Ensures all required fixture binaries exist."""
        fixtures_dir = self.corpus_dir / "fixtures"
        fixtures_dir.mkdir(parents=True, exist_ok=True)

        openssl_bin = fixtures_dir / "openssl_elf.bin"
        if not openssl_bin.exists():
            data = synthesize_elf_binary(
                ["libcrypto.so.3"],
                ["EVP_EncryptInit_ex", "OpenSSL_version", "OPENSSL_init_crypto"],
                "OpenSSL 3.0.8 OPENSSLDIR: /etc/ssl",
            )
            openssl_bin.write_bytes(data)

        mbedtls_bin = fixtures_dir / "mbedtls_elf.bin"
        if not mbedtls_bin.exists():
            data = synthesize_elf_binary(
                ["libmbedcrypto.so.7"],
                ["mbedtls_aes_crypt_ecb", "mbedtls_sha256", "mbedtls_ssl_init"],
                "mbed TLS 3.6.0 MBEDTLS_ERR_AES_INVALID_KEY_LENGTH",
            )
            mbedtls_bin.write_bytes(data)

        wolfssl_bin = fixtures_dir / "wolfssl_elf.bin"
        if not wolfssl_bin.exists():
            data = synthesize_elf_binary(
                ["libwolfssl.so.35"],
                ["wolfSSL_Init", "wc_InitSha256", "wolfSSL_CTX_new"],
                "wolfSSL version 5.6.0 wolfCrypt",
            )
            wolfssl_bin.write_bytes(data)

        clean_bin = fixtures_dir / "clean_binary.bin"
        if not clean_bin.exists():
            data = synthesize_elf_binary(
                ["libc.so.6"],
                ["printf", "malloc", "free", "exit"],
                "GNU C Library 2.35 Generic application string",
            )
            clean_bin.write_bytes(data)

    def load_manifest(self) -> Dict[str, Any]:
        """Loads ground truth binary manifest."""
        if not self.manifest_path.exists():
            raise FileNotFoundError(f"Binary golden corpus manifest not found: {self.manifest_path}")
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def scan_binary_file(self, target_path: Path) -> List[Dict[str, Any]]:
        """
        Parses and fingerprints an individual binary file.
        """
        meta = analyze_binary(str(target_path), worker_isolation=False)
        results = self.fingerprinter.fingerprint(meta.imported_libraries, meta.symbols, meta.strings)
        findings = []
        for r in results:
            if r.is_positive:
                findings.append({
                    "library_name": r.library_name,
                    "confidence": r.confidence,
                    "score": r.score,
                    "matched_libraries": r.matched_libraries,
                    "matched_symbols": r.matched_symbols,
                    "matched_strings": r.matched_strings,
                    "rationale": r.rationale,
                })
        return findings

    def run_evaluation(self) -> Dict[str, Any]:
        """Executes full evaluation over all binary golden corpus targets."""
        manifest = self.load_manifest()
        entries = manifest.get("entries", [])
        categories = manifest.get("categories", [])

        monitor = ResourceMonitor()
        monitor.start()
        start_time = time.perf_counter()

        tp = 0
        fp = 0
        fn = 0
        tn = 0

        category_stats = {
            cat: {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "precision": 0.0, "recall": 0.0, "f1": 0.0}
            for cat in categories
        }

        detailed_results = []
        total_expected = 0

        for entry in entries:
            rel_path = entry["file_path"]
            category = entry.get("category", "unknown")
            is_negative = entry.get("is_negative", False)
            expected_findings = entry.get("expected_findings", [])
            total_expected += len(expected_findings)

            if category not in category_stats:
                category_stats[category] = {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "precision": 0.0, "recall": 0.0, "f1": 0.0}

            target_path = self.corpus_dir / rel_path
            detected = self.scan_binary_file(target_path)

            file_tp = 0
            file_fp = 0
            file_fn = 0
            file_tn = 0

            matched_detected = set()

            for exp in expected_findings:
                exp_lib = exp.get("library_name", "").lower()
                exp_conf = exp.get("confidence", "").lower()
                matched = False
                for idx, det in enumerate(detected):
                    if idx in matched_detected:
                        continue
                    det_lib = det.get("library_name", "").lower()
                    det_conf = det.get("confidence", "").lower()
                    if exp_lib == det_lib:
                        if not exp_conf or exp_conf == det_conf:
                            matched = True
                            matched_detected.add(idx)
                            break
                if matched:
                    file_tp += 1
                else:
                    file_fn += 1

            if is_negative:
                file_fp = len(detected)
                if file_fp == 0:
                    file_tn = 1
                    tn += 1
            else:
                file_fp = len(detected) - len(matched_detected)
                if file_fp < 0:
                    file_fp = 0

            tp += file_tp
            fp += file_fp
            fn += file_fn

            category_stats[category]["tp"] += file_tp
            category_stats[category]["fp"] += file_fp
            category_stats[category]["fn"] += file_fn
            category_stats[category]["tn"] += file_tn

            detailed_results.append({
                "file_path": rel_path,
                "category": category,
                "is_negative": is_negative,
                "expected_findings": expected_findings,
                "detected_findings": detected,
                "tp": file_tp,
                "fp": file_fp,
                "fn": file_fn,
                "tn": file_tn,
            })

        metrics = monitor.stop()
        total_time = time.perf_counter() - start_time

        precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

        for cat, stat in category_stats.items():
            c_tp = stat["tp"]
            c_fp = stat["fp"]
            c_fn = stat["fn"]
            stat["precision"] = round(c_tp / (c_tp + c_fp) if (c_tp + c_fp) > 0 else 1.0, 4)
            stat["recall"] = round(c_tp / (c_tp + c_fn) if (c_tp + c_fn) > 0 else 1.0, 4)
            p = stat["precision"]
            r = stat["recall"]
            stat["f1"] = round(2 * p * r / (p + r) if (p + r) > 0 else 0.0, 4)

        return {
            "evaluation_timestamp": metrics.sample_timestamp,
            "corpus_standard": manifest.get("standard", "Phase 30 Binary Golden Corpus"),
            "total_targets": len(entries),
            "total_expected_findings": total_expected,
            "metrics": {
                "precision": round(precision, 4),
                "recall": round(recall, 4),
                "f1_score": round(f1, 4),
                "true_positives": tp,
                "false_positives": fp,
                "false_negatives": fn,
                "true_negatives": tn,
            },
            "performance": {
                "scan_time_seconds": round(total_time, 4),
                "wall_time_seconds": round(metrics.wall_time_seconds, 4),
                "peak_memory_mb": round(metrics.peak_ram_mb, 2),
                "throughput_targets_per_second": round(len(entries) / max(total_time, 0.001), 2),
            },
            "category_breakdown": category_stats,
            "detailed_target_results": detailed_results,
        }

    def generate_report(self, results: Dict[str, Any]) -> str:
        """Formats the evaluation outcome as a comprehensive markdown document."""
        m = results["metrics"]
        p = results["performance"]
        cats = results["category_breakdown"]

        lines = [
            "# ECDAT Binary Golden Corpus Empirical Benchmark Report (Phase 30 / P2)",
            "",
            "## Executive Summary",
            "",
            "This report documents the accuracy and performance benchmark of the ECDAT Binary & Container Scanner",
            f"against ground-truth ELF binary fixtures defined in `{self.manifest_path.name}`.",
            "",
            f"- **Timestamp**: `{results.get('evaluation_timestamp', 'N/A')}`",
            f"- **Corpus Standard**: `{results.get('corpus_standard', 'Phase 30 Binary Golden Corpus')}`",
            f"- **Total Binary Targets Evaluated**: `{results.get('total_targets', 0)}`",
            f"- **Precision**: **{m['precision'] * 100:.1f}%** (Target: ≥90.0%)",
            f"- **Recall**: **{m['recall'] * 100:.1f}%** (Target: ≥95.0%)",
            f"- **F1 Score**: **{m['f1_score'] * 100:.1f}%**",
            f"- **False Positives**: `{m['false_positives']}`",
            f"- **False Negatives**: `{m['false_negatives']}`",
            f"- **True Negatives**: `{m['true_negatives']}`",
            "",
            "## Performance & Resource Utilization",
            "",
            "| Metric | Value |",
            "| :--- | :--- |",
            f"| Total Scan Time | {p['scan_time_seconds']:.4f} s |",
            f"| Wall Clock Time | {p['wall_time_seconds']:.4f} s |",
            f"| Peak Memory Utilization | {p['peak_memory_mb']:.2f} MB |",
            f"| Throughput | {p['throughput_targets_per_second']:.2f} binaries/sec |",
            "",
            "## Category Breakdown",
            "",
            "| Category | TP | FP | FN | TN | Precision | Recall | F1 Score | Status |",
            "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
        ]

        for cat_name, c in cats.items():
            pass_status = "PASS" if c["precision"] >= 0.90 and c["recall"] >= 0.95 else "WARN"
            lines.append(
                f"| `{cat_name}` | {c['tp']} | {c['fp']} | {c['fn']} | {c.get('tn', 0)} | "
                f"{c['precision']*100:.1f}% | {c['recall']*100:.1f}% | {c['f1']*100:.1f}% | {pass_status} |"
            )

        lines.extend([
            "",
            "## Target-by-Target Ground-Truth Results",
            "",
            "| Target File | Category | Expected Findings | Detected Findings | TP | FP | FN | Status |",
            "| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: |",
        ])

        for target in results.get("detailed_target_results", []):
            fpath = target["file_path"]
            cat = target["category"]
            exp_strs = [f"{e.get('library_name')} ({e.get('confidence')})" for e in target.get("expected_findings", [])] or ["None (Clean)"]
            det_strs = [f"{d.get('library_name')} ({d.get('confidence')})" for d in target.get("detected_findings", [])] or ["None"]
            exp_desc = "<br>".join(exp_strs)
            det_desc = "<br>".join(det_strs)
            c_status = "OK" if target["fp"] == 0 and target["fn"] == 0 else "FAIL"

            lines.append(
                f"| `{fpath}` | `{cat}` | {exp_desc} | {det_desc} | "
                f"{target['tp']} | {target['fp']} | {target['fn']} | {c_status} |"
            )

        lines.extend([
            "",
            "---",
            "*Report dynamically generated by `testing/corpora/binary_golden_corpus/evaluator.py` during automated benchmark execution.*",
        ])

        return "\n".join(lines)

    def save_benchmark_artifacts(self, results: Dict[str, Any], output_dir: Optional[Path] = None) -> Tuple[Path, Path]:
        """Saves evaluation results and markdown report to disk."""
        target_dir = output_dir or (REPO_ROOT / "artifacts" / "benchmarks")
        target_dir.mkdir(parents=True, exist_ok=True)

        report_path = target_dir / "BINARY_GOLDEN_CORPUS_REPORT.md"
        report_content = self.generate_report(results)
        report_path.write_text(report_content, encoding="utf-8")

        json_path = self.corpus_dir / "binary_golden_corpus_results.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        return report_path, json_path


if __name__ == "__main__":
    evaluator = BinaryGoldenCorpusEvaluator()
    print("Running Binary Golden Corpus Evaluation...")
    results = evaluator.run_evaluation()
    report_path, json_path = evaluator.save_benchmark_artifacts(results)
    print(f"Evaluation complete.")
    print(f"Precision: {results['metrics']['precision']*100:.1f}%")
    print(f"Recall:    {results['metrics']['recall']*100:.1f}%")
    print(f"F1 Score:  {results['metrics']['f1_score']*100:.1f}%")
    print(f"Report saved to: {report_path}")
    print(f"JSON saved to:   {json_path}")
