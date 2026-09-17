import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

def check_report(report_path: Path):
    content = report_path.read_text(encoding="utf-8")
    # find all code-ticked paths starting with tests/ or backend/
    code_ticks = re.findall(r'`([^`]+)`', content)
    missing = []
    for item in code_ticks:
        if item.startswith(("tests/", "backend/", "scanners/", "scripts/", "rules/")):
            # strip trailing colons or commas
            clean_item = item.strip().rstrip(",;:")
            # if it ends with / it's a directory
            p = REPO_ROOT / clean_item
            if not p.exists():
                missing.append(clean_item)
    return missing

if __name__ == "__main__":
    report_file = REPO_ROOT / "FINAL_TEST_REPORT.md"
    missing = check_report(report_file)
    print(f"Missing paths in {report_file.name}:")
    for m in missing:
        print(f"  - {m}")
