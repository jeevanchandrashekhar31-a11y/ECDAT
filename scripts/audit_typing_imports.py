import ast
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

COMMON_TYPING_NAMES = {
    "Any", "Union", "Optional", "Tuple", "List", "Dict", "Set", "FrozenSet",
    "Callable", "Type", "Iterable", "Mapping", "Sequence", "MutableMapping",
    "MutableSequence", "Pattern", "Match", "Literal", "Final", "Protocol",
    "ClassVar", "TypeVar", "Generic", "overload", "cast", "TypedDict",
    "NamedTuple", "Generator", "AsyncGenerator", "Coroutine", "DefaultDict",
    "Deque", "Counter"
}

TARGET_DIRS = ["scanners", "backend", "scripts", "testing"]

def find_py_files():
    py_files = []
    for d in TARGET_DIRS:
        dir_path = REPO_ROOT / d
        if dir_path.exists():
            for p in dir_path.rglob("*.py"):
                if any(part in p.parts for part in ["venv", ".venv", "node_modules", "__pycache__", ".pytest_cache", "mbedtls", "golden_corpus"]):
                    continue
                # Skip the audit script itself
                if p.name == "audit_typing_imports.py":
                    continue
                py_files.append(p)
    return py_files

def check_ast_annotations(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    try:
        tree = ast.parse(content, filename=str(path))
    except Exception as e:
        return [f"AST Parse Error: {e}"]

    # Collect all top-level / module-scope imported names and defined names
    module_scope_names = set(dir(__builtins__))
    
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.asname or alias.name.split(".")[0]
                module_scope_names.add(name)
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                name = alias.asname or alias.name
                module_scope_names.add(name)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            module_scope_names.add(node.name)
        elif isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    module_scope_names.add(target.id)
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name):
                module_scope_names.add(node.target.id)

    missing_typing = []

    # Helper to traverse annotation expressions
    def inspect_annotation(anno_node, location_desc):
        if anno_node is None:
            return
        for sub in ast.walk(anno_node):
            if isinstance(sub, ast.Name):
                if sub.id in COMMON_TYPING_NAMES and sub.id not in module_scope_names:
                    missing_typing.append(f"{location_desc}: '{sub.id}' is used in type annotation but not imported at module scope (line {sub.lineno})")

    # Traverse entire AST looking for annotations
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            inspect_annotation(node.returns, f"function '{node.name}' return type")
            for arg in node.args.args + node.args.kwonlyargs:
                inspect_annotation(arg.annotation, f"function '{node.name}' parameter '{arg.arg}'")
            if node.args.vararg:
                inspect_annotation(node.args.vararg.annotation, f"function '{node.name}' *{node.args.vararg.arg}")
            if node.args.kwarg:
                inspect_annotation(node.args.kwarg.annotation, f"function '{node.name}' **{node.args.kwarg.arg}")
        elif isinstance(node, ast.AnnAssign):
            inspect_annotation(node.annotation, "annotated assignment")

    return missing_typing

def check_import_subprocess(path: Path):
    rel_path = path.relative_to(REPO_ROOT)
    # Check if this can be imported as a module
    parts = list(rel_path.with_suffix("").parts)
    # If path is inside testing/corpora or scripts/, can run python -c "..."
    # Set PYTHONPATH to REPO_ROOT
    env = os.environ.copy()
    env["PYTHONPATH"] = str(REPO_ROOT)
    mod_str = ".".join(parts)
    
    cmd = [sys.executable, "-c", f"import {mod_str}"]
    try:
        res = subprocess.run(cmd, cwd=str(REPO_ROOT), env=env, capture_output=True, text=True, timeout=5)
        if res.returncode != 0:
            err = res.stderr.strip() or res.stdout.strip()
            return [f"Subprocess import failed ({mod_str}): {err.splitlines()[-1] if err else 'Unknown error'}"]
    except subprocess.TimeoutExpired:
        return [f"Import timeout (>5s) for {mod_str} (possible blocking execution on import)"]
    except Exception as e:
        return [f"Subprocess exception: {e}"]
    return []

def main():
    py_files = sorted(find_py_files())
    print(f">> Auditing {len(py_files)} Python files across {TARGET_DIRS} for missing typing imports and import errors...\n")
    
    ast_issues = {}
    import_issues = {}
    
    for p in py_files:
        rel = str(p.relative_to(REPO_ROOT))
        # 1. AST annotation audit
        issues = check_ast_annotations(p)
        if issues:
            ast_issues[rel] = issues
            
        # 2. Subprocess import audit
        imp_issues = check_import_subprocess(p)
        if imp_issues:
            import_issues[rel] = imp_issues

    print("=== AST TYPING ANNOTATION AUDIT RESULTS ===")
    if not ast_issues:
        print("PASS: No missing typing imports found in annotations across any audited files.")
    else:
        for f, issues in ast_issues.items():
            print(f"\n[FAIL] {f}:")
            for issue in issues:
                print(f"  - {issue}")

    print("\n=== SUBPROCESS IMPORT AUDIT RESULTS ===")
    if not import_issues:
        print("PASS: All modules import cleanly without exceptions or timeouts.")
    else:
        for f, issues in import_issues.items():
            print(f"\n[FAIL] {f}:")
            for issue in issues:
                print(f"  - {issue}")

if __name__ == "__main__":
    main()
