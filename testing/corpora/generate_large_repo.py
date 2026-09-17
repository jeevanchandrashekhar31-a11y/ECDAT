"""
ECDAT Synthetic Large-Repository Corpus Generator (Phase 21.1)

Generates realistic, multi-language source repositories for scaling benchmarks:
- 100K LOC (~500 files)
- 500K LOC (~2,500 files)
- 1M+ LOC (~5,000 files)

Features:
- Deterministic Pseudorandom Generation: Fixed seed (seed=42) produces 100% reproducible byte streams.
- Multi-Language Mix: Python, C/C++, Go, JavaScript/TypeScript, Java.
- Realistic Cryptographic Footprint: Combines modern secure primitives (AES-256-GCM,
  SHA-384, Ed25519, TLS 1.3) with legacy weak patterns (MD5, SHA-1, DES, RC4, RSA-1024).
- Production Module Tree: Distributes code across core, auth, crypto, network, storage, api, utils.
- Manifest Inclusion: Adds package.json, package-lock.json, requirements.txt, requirements.lock, go.mod.
"""

import argparse
import json
import os
from pathlib import Path
import random
import sys
from typing import Dict, List, Tuple, Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Module subdirectories mimicking modern enterprise microservice / monorepo
MODULE_NAMES = [
    "core",
    "auth",
    "crypto",
    "network",
    "storage",
    "api",
    "utils",
    "services",
    "gateway",
    "pipeline",
]

# Code template building blocks per language
PYTHON_TEMPLATES = [
    """import hashlib
import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

class DataProcessor_{idx}:
    \"\"\"Handles business logic and cryptographic operations for tenant {idx}.\"\"\"
    def __init__(self, key: bytes):
        self.key = key
        self.algorithm_name = "{algo}"

    def compute_digest(self, payload: bytes) -> str:
        # Checksum calculation
        h = hashlib.{py_hash}()
        h.update(payload)
        return h.hexdigest()

    def process_records(self, items: list) -> dict:
        results = {{}}
        for i, item in enumerate(items):
            checksum = self.compute_digest(str(item).encode('utf-8'))
            results[f"record_{{i}}"] = checksum
        return results

    def encrypt_payload(self, plaintext: bytes) -> bytes:
        iv = os.urandom(16)
        cipher = Cipher(algorithms.{cipher_algo}(self.key), modes.{cipher_mode}({mode_args}))
        encryptor = cipher.encryptor()
        return iv + encryptor.update(plaintext) + encryptor.finalize()
""",
    """import secrets
from typing import Optional, Dict, Any

class TokenService_{idx}:
    def __init__(self, realm: str = "enterprise_{idx}"):
        self.realm = realm
        self.active_sessions: Dict[str, Any] = {{}}

    def generate_token(self, user_id: str) -> str:
        entropy = secrets.token_hex(32)
        token = f"tok_{{self.realm}}_{{user_id}}_{{entropy}}"
        self.active_sessions[user_id] = token
        return token

    def validate_session(self, user_id: str, token: str) -> bool:
        stored = self.active_sessions.get(user_id)
        if not stored:
            return False
        return secrets.compare_digest(stored, token)
"""
]

C_TEMPLATES = [
    """#include <stdio.h>
#include <string.h>
#include <openssl/{c_header}.h>

typedef struct {{
    char session_id[64];
    int status_code;
    unsigned char digest[{digest_len}];
}} session_context_{idx}_t;

int compute_session_hash_{idx}(const unsigned char *input, size_t len, session_context_{idx}_t *ctx) {{
    if (!input || !ctx) return -1;
    {c_hash_call}(input, len, ctx->digest);
    ctx->status_code = 200;
    return 0;
}}

int encrypt_buffer_{idx}(const unsigned char *in, unsigned char *out, int len, const unsigned char *key) {{
    // Cryptographic operation invocation
    {c_cipher_call}
    return len;
}}
""",
    """#include <stdlib.h>
#include <stdbool.h>

typedef struct node_{idx} {{
    int id;
    double weight;
    struct node_{idx} *next;
}} node_{idx}_t;

node_{idx}_t* create_node_{idx}(int id, double weight) {{
    node_{idx}_t *n = (node_{idx}_t*)malloc(sizeof(node_{idx}_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}}

void free_chain_{idx}(node_{idx}_t *head) {{
    while (head) {{
        node_{idx}_t *tmp = head->next;
        free(head);
        head = tmp;
    }}
}}
"""
]

JS_TEMPLATES = [
    """const crypto = require('crypto');

class SecurityGateway_{idx} {{
  constructor(config = {{}}) {{
    this.realm = config.realm || 'tenant_{idx}';
    this.algorithm = '{js_algo}';
  }}

  hashIdentifier(id) {{
    return crypto.createHash('{js_hash}')
      .update(String(id))
      .digest('hex');
  }}

  createCipherStream(key, iv) {{
    return crypto.createCipheriv('{js_cipher}', key, iv);
  }}

  verifySignature(data, signature, publicKey) {{
    const verifier = crypto.createVerify('SHA256');
    verifier.update(data);
    return verifier.verify(publicKey, signature, 'hex');
  }}
}}

module.exports = {{ SecurityGateway_{idx} }};
""",
    """class CacheRegistry_{idx} {{
  constructor(ttlMs = 60000) {{
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }}

  set(key, val) {{
    const expiresAt = Date.now() + this.ttlMs;
    this.cache.set(key, {{ val, expiresAt }});
  }}

  get(key) {{
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {{
      this.cache.delete(key);
      return null;
    }}
    return entry.val;
  }}
}}

module.exports = {{ CacheRegistry_{idx} }};
"""
]

GO_TEMPLATES = [
    """package {pkg_name}

import (
	"crypto/{go_hash}"
	"crypto/cipher"
	"crypto/aes"
	"encoding/hex"
	"fmt"
)

type ClientService_{idx} struct {{
	ClientID string
	Key      []byte
}}

func NewClientService_{idx}(clientID string, key []byte) *ClientService_{idx} {{
	return &ClientService_{idx}{{
		ClientID: clientID,
		Key:      key,
	}}
}}

func (s *ClientService_{idx}) HashData(data []byte) string {{
	h := {go_hash}.New()
	h.Write(data)
	return hex.EncodeToString(h.Sum(nil))
}}

func (s *ClientService_{idx}) EncryptPayload(plaintext []byte) ([]byte, error) {{
	block, err := aes.NewCipher(s.Key)
	if err != nil {{
		return nil, fmt.Errorf("cipher failure: %w", err)
	}}
	gcm, err := cipher.NewGCM(block)
	if err != nil {{
		return nil, fmt.Errorf("gcm failure: %w", err)
	}}
	nonce := make([]byte, gcm.NonceSize())
	return gcm.Seal(nil, nonce, plaintext, nil), nil
}}
"""
]

JAVA_TEMPLATES = [
    """package com.ecdat.service.{pkg_name};

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

public class SecurityManager_{idx} {{
    private final String realm;
    private final byte[] secretKey;

    public SecurityManager_{idx}(String realm, byte[] key) {{
        this.realm = realm;
        this.secretKey = key.clone();
    }}

    public String computeDigest(byte[] input) throws NoSuchAlgorithmException {{
        MessageDigest md = MessageDigest.getInstance("{java_hash}");
        byte[] hash = md.digest(input);
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) {{
            sb.append(String.format("%02x", b));
        }}
        return sb.toString();
    }}

    public byte[] encryptBlock(byte[] plaintext) throws Exception {{
        SecretKeySpec keySpec = new SecretKeySpec(secretKey, "AES");
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, keySpec);
        return cipher.doFinal(plaintext);
    }}
}}
"""
]


def generate_python_file(idx: int) -> Tuple[str, str]:
    """Returns (filename, content)."""
    filename = f"worker_{idx:05d}.py"
    algo_choice = random.choice([
        ("AES", "sha256", "AES", "CBC", "iv"),
        ("AES", "sha384", "AES", "GCM", "iv"),
        ("DES", "md5", "TripleDES", "CBC", "iv"),  # Legacy weak finding
        ("ChaCha20", "sha512", "ChaCha20", "CBC", "iv"),
    ])
    tmpl = random.choice(PYTHON_TEMPLATES)
    content = tmpl.format(
        idx=idx,
        algo=algo_choice[0],
        py_hash=algo_choice[1],
        cipher_algo=algo_choice[2],
        cipher_mode=algo_choice[3],
        mode_args=algo_choice[4],
    )
    # Pad to ~200 lines with realistic utility functions
    padding_lines = [
        f"def compute_metric_{idx}_{i}(val: float) -> float:\n    \"\"\"Utility computation {i}.\"\"\"\n    factor = {i * 1.5 + 0.1:.2f}\n    return val * factor + {i}\n"
        for i in range(25)
    ]
    content += "\n" + "\n".join(padding_lines)
    return filename, content


def generate_c_file(idx: int) -> Tuple[str, str]:
    filename = f"cipher_unit_{idx:05d}.c"
    choice = random.choice([
        ("sha", 32, "SHA256", "AES_128_CBC(in, out, len, key);", "evp"),
        ("md5", 16, "MD5", "DES_ecb_encrypt((DES_cblock*)in, (DES_cblock*)out, NULL, 1);", "des"),
        ("sha", 20, "SHA1", "RC4(NULL, len, in, out);", "rc4"),
    ])
    tmpl = random.choice(C_TEMPLATES)
    content = tmpl.format(
        idx=idx,
        c_header=choice[4],
        digest_len=choice[1],
        c_hash_call=choice[2],
        c_cipher_call=choice[3],
    )
    padding_lines = [
        f"int calculate_metric_{idx}_{i}(int v) {{\n    return (v * {i + 1}) + {i * 3};\n}}\n"
        for i in range(25)
    ]
    content += "\n" + "\n".join(padding_lines)
    return filename, content


def generate_js_file(idx: int) -> Tuple[str, str]:
    filename = f"handler_{idx:05d}.js"
    choice = random.choice([
        ("AES-GCM", "sha256", "aes-256-gcm"),
        ("DES", "md5", "des-cbc"),
        ("AES-CBC", "sha1", "aes-128-cbc"),
    ])
    tmpl = random.choice(JS_TEMPLATES)
    content = tmpl.format(
        idx=idx,
        js_algo=choice[0],
        js_hash=choice[1],
        js_cipher=choice[2],
    )
    padding_lines = [
        f"function formatResponse_{idx}_{i}(req) {{\n  return {{ id: '{idx}_{i}', ok: true, code: {i * 10} }};\n}}"
        for i in range(25)
    ]
    content += "\n" + "\n".join(padding_lines)
    return filename, content


def generate_go_file(idx: int, pkg_name: str) -> Tuple[str, str]:
    filename = f"service_{idx:05d}.go"
    go_hash = random.choice(["sha256", "sha512", "md5"])
    content = GO_TEMPLATES[0].format(idx=idx, pkg_name=pkg_name, go_hash=go_hash)
    padding_lines = [
        f"func CalculateMetric_{idx}_{i}(input int) int {{\n\treturn input*{i + 1} + {i}\n}}"
        for i in range(25)
    ]
    content += "\n" + "\n".join(padding_lines)
    return filename, content


def generate_java_file(idx: int, pkg_name: str) -> Tuple[str, str]:
    filename = f"SecurityManager_{idx:05d}.java"
    java_hash = random.choice(["SHA-256", "SHA-384", "MD5", "SHA-1"])
    content = JAVA_TEMPLATES[0].format(idx=idx, pkg_name=pkg_name, java_hash=java_hash)
    padding_lines = [
        f"    public int calculateScore_{idx}_{i}(int base) {{\n        return base * {i + 1};\n    }}"
        for i in range(25)
    ]
    content += "\n" + "\n".join(padding_lines) + "\n}\n"
    return filename, content


def write_manifests(target_dir: Path):
    """Writes standard package manifests and lockfiles to repository root."""
    pkg_json = {
        "name": "enterprise-monorepo",
        "version": "2.4.0",
        "dependencies": {
            "express": "^4.19.2",
            "crypto-js": "^4.2.0",
            "dotenv": "^16.4.5"
        }
    }
    with open(target_dir / "package.json", "w", encoding="utf-8") as f:
        json.dump(pkg_json, f, indent=2)

    pkg_lock = {
        "name": "enterprise-monorepo",
        "version": "2.4.0",
        "lockfileVersion": 3,
        "packages": {
            "": {"name": "enterprise-monorepo", "version": "2.4.0"},
            "node_modules/crypto-js": {"version": "4.2.0", "resolved": "https://registry.npmjs.org/crypto-js/-/crypto-js-4.2.0.tgz"}
        }
    }
    with open(target_dir / "package-lock.json", "w", encoding="utf-8") as f:
        json.dump(pkg_lock, f, indent=2)

    req_txt = "cryptography==42.0.5\npycryptodome==3.20.0\nrequests==2.31.0\n"
    with open(target_dir / "requirements.txt", "w", encoding="utf-8") as f:
        f.write(req_txt)

    with open(target_dir / "requirements.lock", "w", encoding="utf-8") as f:
        f.write(req_txt + "# Pinned lockfile\n")

    go_mod = "module enterprise/monorepo\n\ngo 1.22\n"
    with open(target_dir / "go.mod", "w", encoding="utf-8") as f:
        f.write(go_mod)


def generate_corpus(target_loc: int, output_dir: Path) -> Dict[str, Any]:
    """
    Generates a synthetic multi-language repository totaling target_loc lines of code.
    """
    random.seed(42)  # Deterministic seed for reproducible generation
    output_dir.mkdir(parents=True, exist_ok=True)

    # Average file is ~200 LOC
    estimated_files = max(target_loc // 200, 10)
    print(f">> Generating ~{target_loc:,} LOC across ~{estimated_files:,} files in {output_dir}...")

    total_loc = 0
    total_files = 0
    language_counts: Dict[str, int] = {
        "python": 0, "c": 0, "javascript": 0, "go": 0, "java": 0
    }

    # Setup module directories
    module_dirs = [output_dir / "src" / m for m in MODULE_NAMES]
    for md in module_dirs:
        md.mkdir(parents=True, exist_ok=True)

    file_idx = 0
    while total_loc < target_loc:
        file_idx += 1
        mod_dir = module_dirs[file_idx % len(module_dirs)]
        pkg_name = mod_dir.name
        lang_choice = file_idx % 5

        if lang_choice == 0:
            fname, code = generate_python_file(file_idx)
            language_counts["python"] += 1
        elif lang_choice == 1:
            fname, code = generate_c_file(file_idx)
            language_counts["c"] += 1
        elif lang_choice == 2:
            fname, code = generate_js_file(file_idx)
            language_counts["javascript"] += 1
        elif lang_choice == 3:
            fname, code = generate_go_file(file_idx, pkg_name)
            language_counts["go"] += 1
        else:
            fname, code = generate_java_file(file_idx, pkg_name)
            language_counts["java"] += 1

        fpath = mod_dir / fname
        with open(fpath, "w", encoding="utf-8") as f:
            f.write(code)

        loc = code.count("\n") + 1
        total_loc += loc
        total_files += 1

    write_manifests(output_dir)

    metadata = {
        "target_loc_requested": target_loc,
        "actual_loc": total_loc,
        "total_files": total_files,
        "language_distribution": language_counts,
        "target_dir": str(output_dir.resolve()),
    }

    with open(output_dir / "corpus_metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"   Generated {total_files:,} files ({total_loc:,} actual LOC).")
    return metadata


def main():
    parser = argparse.ArgumentParser(description="ECDAT Synthetic Large-Repository Corpus Generator")
    parser.add_argument(
        "--size",
        choices=["100k", "500k", "1m"],
        default="100k",
        help="Preset repository size to generate",
    )
    parser.add_argument("--loc", type=int, default=None, help="Explicit target LOC count")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Destination directory for generated corpus",
    )
    args = parser.parse_args()

    presets = {
        "100k": 100000,
        "500k": 500000,
        "1m": 1000000,
    }

    target_loc = args.loc if args.loc else presets[args.size]
    out_name = f"repo_{args.size}" if not args.loc else f"repo_{target_loc}loc"
    out_dir = (
        Path(args.output_dir)
        if args.output_dir
        else REPO_ROOT / "tests" / "fixtures" / "large_repos" / out_name
    )

    meta = generate_corpus(target_loc, out_dir)
    print(f">> Corpus generation complete: {meta['actual_loc']:,} LOC in {meta['target_dir']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
