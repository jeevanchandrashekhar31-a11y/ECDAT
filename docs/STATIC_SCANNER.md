# ECDAT Static Code Scanner

The static scanner (Phase 3) is a robust hybrid analysis pipeline designed to identify cryptographic operations in C, C++, Go, and JavaScript source code.

## Architecture

The static scanner utilizes a two-pass architecture:

1. **Regex Baseline**: Uses standard regular expressions and heuristics to quickly identify weak random number generators (`rand`, `srand`), potentially hardcoded keys, and string-matching for common algorithms (e.g. `MD5`, `SHA-1`, `DES`).
2. **Tree-sitter AST (Abstract Syntax Tree)**: Parses the code grammatically for C, C++, Go, and Node.js/JavaScript. It looks for specific cryptographic API invocations (like `EVP_sha256()`, `mbedtls_md5()`, `crypto.createHash()`, `sha256.New()`) and outputs them with `high` confidence, deduplicating any overlapping regex matches.
3. **Optional Groq LLM Verification**: Using the `--llm-verify` flag, the scanner attempts to contextually verify ambiguous findings (such as custom crypto wrappers or generic API names). It strictly sanitizes the snippet via `privacy_filter.py` before sending it to the Groq API.

## Security Controls

The scanner strictly adheres to the ECDAT global engineering rules:
- **Zero Secrets Exfiltration**: `sanitization.py` ensures that literal PEM contents, API keys, passwords, and tokens are scrubbed and replaced with a SHA-256 fingerprint before generating reports.
- **Safe Directory Traversal**: By default, symlinks are not followed to prevent attacks outside the scan root directory.
- **Privacy Filter**: When using `--llm-verify`, `privacy_filter.py` applies a robust redaction mechanism to ensure sensitive data NEVER leaves the local machine.

## Usage

```bash
# Standard run outputting a CycloneDX CBOM
python -m scanners.static.main . -o artifacts/static_cbom.json

# Outputting SARIF 2.1.0 format
python -m scanners.static.main . -o artifacts/static_cbom.json --output-sarif artifacts/static_results.sarif

# Enable LLM Verification (Requires GROQ_API_KEY environment variable)
python -m scanners.static.main . --llm-verify --llm-provider groq
```

## SARIF Integration
The SARIF output conforms to version 2.1.0 and is suitable for ingestion by common CI/CD tools, GitHub Code Scanning, or GitLab SAST platforms.
