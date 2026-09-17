import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

LEAKED_PREFIX_ENCODED = "file:///c:/Users/Jeevan%20c/Documents/ECDAT/"
LEAKED_PREFIX_RAW = "file:///c:/Users/Jeevan c/Documents/ECDAT/"
LEAKED_PREFIX_WIN = "C:/Users/Jeevan c/Documents/ECDAT/"
LEAKED_PREFIX_BACKSLASH = "C:\\Users\\Jeevan c\\Documents\\ECDAT\\"

def clean_file(path: Path):
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return 0

    original = content
    # Replace all variations of the local absolute prefix with relative paths
    content = content.replace(LEAKED_PREFIX_ENCODED, "")
    content = content.replace(LEAKED_PREFIX_RAW, "")
    content = content.replace(LEAKED_PREFIX_WIN, "")
    content = content.replace(LEAKED_PREFIX_BACKSLASH, "")
    
    # Also check case variations like file:///C:/
    content = content.replace("file:///C:/Users/Jeevan%20c/Documents/ECDAT/", "")
    content = content.replace("file:///C:/Users/Jeevan c/Documents/ECDAT/", "")

    if content != original:
        path.write_text(content, encoding="utf-8")
        return original.count("file:///c:/Users") + original.count("file:///C:/Users")
    return 0

def main():
    total_replaced = 0
    modified_files = []
    
    for p in REPO_ROOT.rglob("*.md"):
        if any(x in p.parts for x in ["node_modules", ".git", "venv", ".venv"]):
            continue
        count = clean_file(p)
        if count > 0:
            modified_files.append((str(p.relative_to(REPO_ROOT)), count))
            total_replaced += count

    print(f"Cleaned {len(modified_files)} files, replaced {total_replaced} occurrences of leaked paths.")
    for f, c in modified_files:
        print(f"  - {f}: {c} occurrences")

if __name__ == "__main__":
    main()
