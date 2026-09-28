import os
import shutil
import json
import site
import sys

GOLDEN_DIR = os.path.join(os.path.dirname(__file__), "..", "benchmarks", "binary_golden_set")
LABELS_FILE = os.path.join(GOLDEN_DIR, "labels.json")

def find_site_packages():
    return site.getsitepackages()[0]

def build_golden_set():
    os.makedirs(GOLDEN_DIR, exist_ok=True)
    labels = {}

    binaries_to_collect = []

    # Git for Windows
    git_bin = r"C:\Program Files\Git\usr\bin"
    if os.path.exists(git_bin):
        binaries_to_collect.extend([
            (os.path.join(git_bin, "openssl.exe"), "OpenSSL", ["TLS 1.3"]),
            (os.path.join(git_bin, "msys-crypto-3.dll"), "OpenSSL", ["TLS 1.3"]),
            (os.path.join(git_bin, "msys-ssl-3.dll"), "OpenSSL", ["TLS 1.3"]),
            # Negatives from Git
            (os.path.join(git_bin, "cat.exe"), "None", []),
            (os.path.join(git_bin, "echo.exe"), "None", []),
            (os.path.join(git_bin, "true.exe"), "None", []),
            (os.path.join(git_bin, "false.exe"), "None", []),
            (os.path.join(git_bin, "ls.exe"), "None", []),
            (os.path.join(git_bin, "mkdir.exe"), "None", []),
            (os.path.join(git_bin, "rm.exe"), "None", []),
            (os.path.join(git_bin, "touch.exe"), "None", []),
        ])

    # Python
    py_dir = os.path.dirname(sys.executable)
    binaries_to_collect.extend([
        (os.path.join(py_dir, "python.exe"), "Python Core", []),
        (os.path.join(py_dir, "DLLs", "_ssl.pyd"), "OpenSSL", ["TLS 1.3"]),
        (os.path.join(py_dir, "DLLs", "_hashlib.pyd"), "OpenSSL", ["SHA-256", "SHA-512"]),
        # More negatives
        (os.path.join(py_dir, "DLLs", "unicodedata.pyd"), "None", []),
        (os.path.join(py_dir, "DLLs", "_queue.pyd"), "None", []),
    ])

    # site-packages (cryptography, PyNaCl)
    sp = find_site_packages()
    crypto_dir = os.path.join(sp, "cryptography", "hazmat", "bindings")
    if os.path.exists(crypto_dir):
        for f in os.listdir(crypto_dir):
            if f.endswith(".pyd"):
                binaries_to_collect.append((os.path.join(crypto_dir, f), "OpenSSL", ["TLS 1.3", "AES"]))
                break
                
    nacl_dir = os.path.join(sp, "nacl")
    if os.path.exists(nacl_dir):
        for f in os.listdir(nacl_dir):
            if f.endswith(".pyd") or f.endswith(".dll"):
                binaries_to_collect.append((os.path.join(nacl_dir, f), "libsodium", ["X25519", "Ed25519"]))
                break

    # Node.js
    node_exe = r"C:\Program Files\nodejs\node.exe"
    if os.path.exists(node_exe):
        binaries_to_collect.append((node_exe, "Node/OpenSSL", ["TLS 1.3", "AES"]))

    for src_path, expected_lib, expected_caps in binaries_to_collect:
        if not os.path.exists(src_path):
            continue
            
        base_name = os.path.basename(src_path)
        dest_path = os.path.join(GOLDEN_DIR, base_name)
        
        try:
            shutil.copy2(src_path, dest_path)
            labels[base_name] = {
                "expected_library": expected_lib,
                "expected_capabilities": expected_caps,
                "stripped": False
            }
        except Exception as e:
            print(f"Failed to copy {src_path}: {e}")

    with open(LABELS_FILE, "w") as f:
        json.dump(labels, f, indent=2)

    print(f"Golden set created in {GOLDEN_DIR} with {len(labels)} labels.")

if __name__ == "__main__":
    build_golden_set()
