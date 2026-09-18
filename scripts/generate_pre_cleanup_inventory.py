import os
import sys
import json
import hashlib
import subprocess
from pathlib import Path
from collections import defaultdict

REPO_ROOT = Path("c:/Users/Jeevan c/Documents/ECDAT").resolve()

def get_git_tracked_files():
    try:
        out = subprocess.check_output(["git", "ls-files"], cwd=REPO_ROOT, text=True, encoding="utf-8", errors="replace")
        return set(line.strip().replace("\\", "/") for line in out.splitlines() if line.strip())
    except Exception as e:
        print("Git ls-files error:", e)
        return set()

def get_sha256(filepath):
    try:
        h = hashlib.sha256()
        with open(filepath, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None

def build_inventory():
    tracked_files = get_git_tracked_files()
    print(f"Loaded {len(tracked_files)} tracked files from git.")

    # All files on disk (excluding .git folder)
    inventory = []
    sha_map = defaultdict(list)
    
    # Text index for reference search (exclude heavy fixtures / uploads / vendor dirs)
    searchable_docs = {}
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in [
            ".git", "node_modules", ".pytest_cache", ".ruff_cache", "__pycache__",
            "hostile_repo", "large_repos", "uploads"
        ]]
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in [".py", ".js", ".ts", ".tsx", ".json", ".yml", ".yaml", ".md", ".sh", ".ps1", ".toml", ".ini", "dockerfile"]:
                sf = os.path.join(root, f)
                try:
                    if os.path.getsize(sf) < 500000:
                        with open(sf, "r", encoding="utf-8", errors="ignore") as fp:
                            searchable_docs[os.path.relpath(sf, REPO_ROOT).replace("\\", "/")] = fp.read()
                except Exception:
                    pass

    print(f"Preloaded {len(searchable_docs)} searchable text files into memory for fast reference checking.")

    def count_references(target_name, target_rel):
        refs = []
        for rel_sf, content in searchable_docs.items():
            if rel_sf == target_rel or rel_sf.endswith("generate_pre_cleanup_inventory.py"):
                continue
            if target_name in content or target_rel in content:
                refs.append(rel_sf)
                if len(refs) >= 5:
                    break
        return refs

    # Walk everything with error handling
    for root, dirs, files in os.walk(REPO_ROOT, onerror=lambda err: None):
        if ".git" in root.split(os.sep):
            continue
        # Don't descend into hostile_repo, large_repos or uploads deeply
        if any(h in root.split(os.sep) for h in ["hostile_repo", "large_repos", "uploads"]):
            dirs.clear()
        for f in files:
            abs_path = os.path.join(root, f)
            rel_path = os.path.relpath(abs_path, REPO_ROOT).replace("\\", "/")
            try:
                size = os.path.getsize(abs_path)
            except OSError:
                size = 0

            is_tracked = rel_path in tracked_files
            ext = os.path.splitext(f)[1].lower()
            
            # Classification
            classification = "unknown"
            if "node_modules" in rel_path:
                classification = "generated"
            elif any(c in rel_path for c in ["__pycache__", ".pytest_cache", ".ruff_cache", ".coverage"]):
                classification = "generated"
            elif rel_path.startswith("artifacts/uploads/"):
                classification = "generated"
            elif rel_path.startswith("artifacts/ci/") or (rel_path.startswith("artifacts/test_") and not is_tracked):
                classification = "generated"
            elif rel_path in ["network_cbom.json", "network_scan_audit.jsonl"]:
                classification = "generated"
            elif rel_path.startswith(".keys/"):
                classification = "security_sensitive"
            elif rel_path.startswith("tests/fixtures/") or rel_path.startswith("testing/corpora/"):
                classification = "fixture"
            elif rel_path.startswith("tests/") or rel_path.startswith("testing/"):
                classification = "test"
            elif rel_path.startswith("docs/") or rel_path.endswith(".md"):
                classification = "documentation"
            elif rel_path in [".dockerignore", ".gitignore", ".gitmodules", "package.json", "package-lock.json", "pyproject.toml", "pytest.ini", "requirements.txt", "requirements.lock", "requirements-lock.txt", "docker-compose.yml"] or rel_path.endswith((".json", ".yml", ".yaml", ".env.example")):
                classification = "configuration"
            elif rel_path.startswith(("backend/src/", "scanners/", "frontend/src/", "rules/", "scripts/")):
                classification = "source"
            elif rel_path.startswith("examples/"):
                classification = "example"
            elif rel_path.startswith("artifacts/"):
                classification = "release_artifact"

            # Recommended action & rationale
            recommended_action = "KEEP"
            reason = "Active repository component"
            confidence = "HIGH"

            # Check specific rules
            if any(c in rel_path for c in ["__pycache__", ".pytest_cache", ".ruff_cache", ".coverage"]):
                recommended_action = "DELETE"
                reason = "Python cache / coverage file - Section 3 compliance"
            elif rel_path.startswith("artifacts/uploads/"):
                recommended_action = "DELETE"
                reason = "Generated runtime scan/upload directory - Section 5 compliance"
            elif rel_path.startswith("artifacts/ci/") or (rel_path.startswith("artifacts/test_") and not is_tracked):
                recommended_action = "DELETE"
                reason = "Local untracked scan/test output - Section 6 compliance"
            elif rel_path in ["network_cbom.json", "network_scan_audit.jsonl"]:
                recommended_action = "DELETE"
                reason = "Local runtime network scan output in root - Section 6 compliance"
            elif rel_path.startswith(".keys/"):
                recommended_action = "DELETE"
                reason = "Untracked private key / key directory - Section 2 P0 credential compliance"
            elif rel_path == "REPO_INVENTORY.json":
                recommended_action = "DELETE"
                reason = "Unreferenced historical repository dump in root - Section 12 compliance"
            elif rel_path in ["FINAL_CBOM_SAMPLE.json", "FINAL_SBOM_SAMPLE.json"]:
                recommended_action = "MOVE"
                reason = f"Sample artifact moved to examples/ - Section 6 & 9 compliance"
            elif rel_path in [
                "FINAL_10_10_REPORT.md", "MASTER_10_10_VERIFICATION.md", "FINAL_SECURITY_ASSESSMENT.md",
                "FINAL_BENCHMARK_REPORT.md", "FINAL_TEST_REPORT.md", "FINAL_FEATURE_PARITY_MATRIX.md",
                "BETTER_THAN_IBM.md", "CURRENT_STATE.md", "BASELINE_SECURITY_REPORT.md",
                "BASELINE_TEST_AND_PERFORMANCE.md", "DEPENDENCY_INVENTORY.md", "DEPENDENCY_RISK.md",
                "FINAL_ARCHITECTURE.md", "ARCHITECTURE_CURRENT.md", "FINAL_THREAT_MODEL.md",
                "ECDAT_CBOM_SCHEMA_CONTRACT.md"
            ]:
                recommended_action = "DELETE"
                reason = "Consolidated into canonical authoritative docs (ARCHITECTURE.md, THREAT_MODEL.md, CBOM_SCHEMA_CONTRACT.md, SECURITY_VERIFICATION.md, SECURITY_LIMITATIONS.md) - Section 8 & 9 compliance"
            elif rel_path.startswith("tests/fixtures/large_repos/"):
                recommended_action = "KEEP"
                reason = "Tracked benchmark scale test fixture (100k, 500k, 1m LOC) - Section 7 & Rule 1 protection"
            elif rel_path.startswith("tests/fixtures/hostile_repo/"):
                recommended_action = "KEEP"
                reason = "Tracked hostile security test fixture (path traversal, zip slip, symlink loop) - Section 7 protection"
            elif rel_path.startswith("artifacts/"):
                if is_tracked:
                    recommended_action = "KEEP"
                    reason = "Tracked release integrity artifact / benchmark / SBOM - Section 11 compliance"
                else:
                    recommended_action = "REVIEW_REQUIRED"
                    reason = "Untracked artifact requiring verification before deletion"
                    confidence = "MEDIUM"

            # Check references for deletion/move candidates (only for config, docs, scripts, root artifacts)
            refs = []
            if recommended_action in ["DELETE", "MOVE", "REVIEW_REQUIRED"]:
                if not any(c in rel_path for c in ["__pycache__", ".pytest_cache", ".ruff_cache", ".coverage", "tests/fixtures/", "artifacts/uploads/"]):
                    refs = count_references(f, rel_path)

            item = {
                "path": rel_path,
                "file_type": ext if ext else "no_extension",
                "size_bytes": size,
                "tracked": is_tracked,
                "classification": classification,
                "references": refs,
                "recommended_action": recommended_action,
                "reason": reason,
                "confidence": confidence
            }
            inventory.append(item)

    print(f"Total inventory items evaluated: {len(inventory)}")
    return inventory

if __name__ == "__main__":
    inv = build_inventory()
    
    # Save JSON inventory
    out_json = REPO_ROOT / "security_audit" / "pre_cleanup_inventory.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=2)
    print(f"Wrote JSON inventory to {out_json}")

    # Build Markdown Summary
    out_md = REPO_ROOT / "security_audit" / "pre_cleanup_inventory.md"
    
    action_counts = defaultdict(int)
    class_counts = defaultdict(int)
    for it in inv:
        action_counts[it["recommended_action"]] += 1
        class_counts[it["classification"]] += 1

    lines = []
    lines.append("# ECDAT Pre-Cleanup Repository Inventory")
    lines.append("")
    lines.append("## 1. Executive Summary")
    lines.append(f"- **Total files evaluated**: {len(inv)}")
    lines.append(f"- **Action breakdown**:")
    for a, c in sorted(action_counts.items()):
        lines.append(f"  - **{a}**: {c}")
    lines.append(f"- **Classification breakdown**:")
    for cl, c in sorted(class_counts.items()):
        lines.append(f"  - **{cl}**: {c}")
    lines.append("")
    lines.append("## 2. Action Table for Primary Candidates")
    lines.append("")
    lines.append("| Path | Type | Size (Bytes) | Tracked | Classification | References | Action | Reason | Confidence |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    
    # Show candidates that are NOT bulk fixtures or bulk node_modules
    for it in inv:
        p = it["path"]
        if "tests/fixtures/large_repos" in p or "node_modules" in p or "artifacts/uploads/scan_1789639413019/tests/fixtures/large_repos" in p:
            continue
        if it["recommended_action"] in ["DELETE", "MOVE", "REVIEW_REQUIRED"] or it["path"].count("/") <= 1:
            refs_str = f"{len(it['references'])} files" if it['references'] else "None"
            lines.append(f"| `{p}` | `{it['file_type']}` | {it['size_bytes']} | {it['tracked']} | {it['classification']} | {refs_str} | **{it['recommended_action']}** | {it['reason']} | {it['confidence']} |")

    lines.append("")
    lines.append("## 3. Protected Test Fixture Corpora (STRICT KEEP)")
    lines.append("- `tests/fixtures/hostile_repo/`: Hostile security regression fixtures (path traversal, symlink loops, zip bomb protection).")
    lines.append("- `tests/fixtures/large_repos/`: Tracked scale benchmark fixtures (100K, 500K, 1M LOC synthetics).")
    lines.append("- `testing/corpora/golden_corpus/`: Golden benchmark detection test cases (11 suites).")
    lines.append("- `examples/real_target/`: Embedded target library fixtures (wolfssl, mbedtls).")
    lines.append("")
    lines.append("## 4. Tracked Release Artifacts (STRICT KEEP)")
    lines.append("- `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.sig`, `artifacts/SHA512SUMS`: Release integrity signatures.")
    lines.append("- `artifacts/provenance/ecdat_provenance.slsa.json`: SLSA build provenance manifest.")
    lines.append("- `artifacts/sbom/*`: CycloneDX and SPDX SBOM release artifacts.")
    lines.append("- `artifacts/security/*`: Signed release gate reports and vulnerability audits.")
    lines.append("- `artifacts/benchmarks/*`: Benchmark performance baseline records.")

    with open(out_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Wrote Markdown inventory to {out_md}")
