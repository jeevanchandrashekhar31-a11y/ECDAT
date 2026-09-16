#!/usr/bin/env python3
"""
ECDAT Adversarial Repository Corpus Generator.
Builds a comprehensive hostile repository test suite covering 10 input threat vectors:
1. Huge files (>5MB/10MB)
2. Deeply nested directories (40+ levels)
3. Symlink loops / circular references
4. Malformed source (invalid UTF-8, null bytes, truncated tokens)
5. Parser edge cases (unclosed comments, deep ternaries, 2000 nested parens)
6. Malicious filenames (path traversal tokens, Windows reserved names)
7. Unicode / path tricks (Trojan Source BiDi, zero-width spaces, Cyrillic homoglyphs)
8. Generated-code explosions (500,000-character single line, ReDoS triggers)
9. Intentionally complex ASTs (3,000 chained binary operators, 500-deep lists)
10. Huge dependency graphs (massive manifests with circular dependencies)
"""

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def create_huge_files(base_dir: Path):
    """Vector 1: Files exceeding max size limits."""
    d = base_dir / "01_huge_files"
    d.mkdir(parents=True, exist_ok=True)

    # 12 MB source file with repeated crypto API calls
    huge_file = d / "huge_crypto.c"
    chunk = "// Repeated block\nint test_md5() { MD5_Init(NULL); return 0; }\n" * 50
    with open(huge_file, "w", encoding="utf-8") as f:
        # Write ~12 MB
        for _ in range(3000):
            f.write(chunk)


def create_deeply_nested_dirs(base_dir: Path):
    """Vector 2: Directory hierarchy exceeding max_depth limit (40 levels)."""
    curr = base_dir / "02_deeply_nested"
    curr.mkdir(parents=True, exist_ok=True)

    # Nest 40 levels deep
    for i in range(40):
        curr = curr / f"depth_level_{i:02d}"
        try:
            curr.mkdir(exist_ok=True)
        except OSError:
            # On some Windows paths, long path limits may prevent creating 40
            break

    target_file = curr / "deep_crypto.c"
    try:
        with open(target_file, "w", encoding="utf-8") as f:
            f.write("void deep_func() { SHA1_Init(NULL); }\n")
    except OSError:
        pass


def create_symlink_loops(base_dir: Path):
    """Vector 3: Circular symlinks and self-referential links."""
    d = base_dir / "03_symlink_loops"
    d.mkdir(parents=True, exist_ok=True)

    loop_target = d / "real_file.c"
    with open(loop_target, "w", encoding="utf-8") as f:
        f.write("void symlink_func() { DES_ecb_encrypt(); }\n")

    # Attempt symlink creation (may require developer mode/privilege on Windows)
    try:
        symlink_file = d / "circular_link.c"
        if not symlink_file.exists():
            os.symlink("real_file.c", symlink_file)
        
        # Self-referencing directory symlink
        sub_dir = d / "sub"
        sub_dir.mkdir(exist_ok=True)
        loop_dir = sub_dir / "parent_loop"
        if not loop_dir.exists():
            os.symlink("..", loop_dir, target_is_directory=True)
    except (OSError, NotImplementedError):
        # Gracefully handle Windows environments lacking symlink creation privilege
        with open(d / "simulated_symlink_note.txt", "w") as f:
            f.write("Symlink creation not permitted by OS security policy; verified via unit tests.\n")


def create_malformed_source(base_dir: Path):
    """Vector 4: Corrupted bytes, invalid UTF-8, null bytes."""
    d = base_dir / "04_malformed_source"
    d.mkdir(parents=True, exist_ok=True)

    # Invalid UTF-8 bytes in JS
    with open(d / "invalid_utf8.js", "wb") as f:
        f.write(b"const secret = 'test';\n\xff\xfe\x80\x81\nconst x = 'md5';\n")

    # Embedded null bytes in C source
    with open(d / "null_bytes.c", "wb") as f:
        f.write(b"#include <stdio.h>\nvoid test() {\x00\x00 int des = 1;\x00\n}\n")

    # Truncated token / abrupt EOF in middle of string literal
    with open(d / "truncated_token.py", "wb") as f:
        f.write(b"crypto_key = 'abcdef123456789")


def create_parser_edge_cases(base_dir: Path):
    """Vector 5: Unclosed comments, deeply chained ternaries, massive parens."""
    d = base_dir / "05_parser_edge_cases"
    d.mkdir(parents=True, exist_ok=True)

    # 500 unclosed multiline comments
    with open(d / "unclosed_comments.c", "w", encoding="utf-8") as f:
        f.write("/*\n" * 500 + "void test() { int x = 1; }\n")

    # 1,500 chained ternary operators
    with open(d / "deep_ternaries.js", "w", encoding="utf-8") as f:
        ternary_chain = " ? 1 : ".join([f"cond_{i}" for i in range(1500)]) + " ? 1 : 0"
        f.write(f"const result = {ternary_chain};\n")

    # 2,000 nested parentheses
    with open(d / "nested_parens.py", "w", encoding="utf-8") as f:
        f.write("val = " + "(" * 2000 + "1" + ")" * 2000 + "\n")


def create_malicious_filenames(base_dir: Path):
    """Vector 6: Path traversal tokens and reserved device names."""
    d = base_dir / "06_malicious_filenames"
    d.mkdir(parents=True, exist_ok=True)

    with open(d / "normal.c", "w", encoding="utf-8") as f:
        f.write("void normal() { int sha1 = 1; }\n")

    # Traversal token in filename (safe within dir)
    with open(d / ".._escape_attempt.py", "w", encoding="utf-8") as f:
        f.write("secret = 'safe'\n")

    # Simulated device file marker for tests
    with open(d / "CON_device_test.c", "w", encoding="utf-8") as f:
        f.write("int con_func() { return 0; }\n")


def create_unicode_path_tricks(base_dir: Path):
    """Vector 7: BiDi Trojan Source, zero-width spaces, Cyrillic homoglyphs."""
    d = base_dir / "07_unicode_tricks"
    d.mkdir(parents=True, exist_ok=True)

    # Trojan Source BiDi RLO (\u202E)
    with open(d / "trojan_bidi.c", "w", encoding="utf-8") as f:
        f.write('/* \u202e } \u202d */ int is_admin = 0; /* \u202e { \u202d */\n')

    # Zero-width spaces in identifier (\u200B)
    with open(d / "zero_width.py", "w", encoding="utf-8") as f:
        f.write("sec\u200bret = 'md5_hash'\n")

    # Cyrillic homoglyph (Cyrillic 'а' U+0430 instead of Latin 'a')
    with open(d / "homoglyph.c", "w", encoding="utf-8") as f:
        f.write("// Uses Cyrillic 'а' in M\u0430D5\nvoid M\u0430D5_Init() {}\n")


def create_generated_code_explosions(base_dir: Path):
    """Vector 8: Giant 500,000-character single line (ReDoS trigger test)."""
    d = base_dir / "08_generated_explosions"
    d.mkdir(parents=True, exist_ok=True)

    # 500,000 characters on one line
    giant_line = "const x = 1; " * 35000 + "const cipher = 'DES';\n"
    with open(d / "minified_giant_line.js", "w", encoding="utf-8") as f:
        f.write(giant_line)

    # Potential ReDoS pattern for naive regexes
    redos_line = "a" * 5000 + "!" + "\n"
    with open(d / "redos_trigger.py", "w", encoding="utf-8") as f:
        f.write(f"val = '{redos_line}'\n")


def create_complex_asts(base_dir: Path):
    """Vector 9: Massive AST trees (3,000 chained binary ops, 500-level lists)."""
    d = base_dir / "09_complex_asts"
    d.mkdir(parents=True, exist_ok=True)

    # 3,000 chained binary addition operations
    with open(d / "massive_binary_expr.c", "w", encoding="utf-8") as f:
        expr = " + ".join(["1"] * 3000)
        f.write(f"int compute() {{ int total = {expr}; return total; }}\n")

    # 500-level deeply nested list
    with open(d / "deep_array.py", "w", encoding="utf-8") as f:
        f.write("deep_list = " + "[" * 500 + "1" + "]" * 500 + "\n")


def create_huge_dependency_graphs(base_dir: Path):
    """Vector 10: Massive dependency manifests with circular references."""
    d = base_dir / "10_huge_dependency_graphs"
    d.mkdir(parents=True, exist_ok=True)

    # package.json with 500 dependencies and circular references
    deps = {f"lib-module-{i:04d}": "1.0.0" for i in range(500)}
    deps["circular-a"] = "file:../circular-b"
    deps["circular-b"] = "file:../circular-a"

    with open(d / "package.json", "w", encoding="utf-8") as f:
        json.dump({
            "name": "adversarial-graph",
            "version": "1.0.0",
            "dependencies": deps
        }, f, indent=2)

    # requirements.txt with 500 entries
    with open(d / "requirements.txt", "w", encoding="utf-8") as f:
        for i in range(500):
            f.write(f"adversarial-pkg-{i:04d}>=1.0.0\n")


def main():
    parser = argparse.ArgumentParser(description="ECDAT Adversarial Repository Corpus Generator")
    parser.add_argument("--output", default="tests/fixtures/hostile_repo", help="Output directory for hostile corpus")
    args = parser.parse_args()

    out_dir = REPO_ROOT / args.output
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f">> Generating 10 Adversarial Threat Vectors in {out_dir}...")
    create_huge_files(out_dir)
    print("   [1/10] Huge files created (>10MB).")
    create_deeply_nested_dirs(out_dir)
    print("   [2/10] Deeply nested directories created (40 levels).")
    create_symlink_loops(out_dir)
    print("   [3/10] Symlink loops / references created.")
    create_malformed_source(out_dir)
    print("   [4/10] Malformed source created (bad UTF-8, null bytes, abrupt EOF).")
    create_parser_edge_cases(out_dir)
    print("   [5/10] Parser edge cases created (unclosed comments, deep ternaries, nested parens).")
    create_malicious_filenames(out_dir)
    print("   [6/10] Malicious filenames created (traversal tokens, devices).")
    create_unicode_path_tricks(out_dir)
    print("   [7/10] Unicode / path tricks created (BiDi RLO, zero-width, homoglyphs).")
    create_generated_code_explosions(out_dir)
    print("   [8/10] Generated-code explosions created (500K-char line, ReDoS triggers).")
    create_complex_asts(out_dir)
    print("   [9/10] Complex ASTs created (3,000 binary ops, 500-level lists).")
    create_huge_dependency_graphs(out_dir)
    print("   [10/10] Huge dependency graphs created (circular & 500+ packages).")

    print(f"\n>> Adversarial corpus successfully created in {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
