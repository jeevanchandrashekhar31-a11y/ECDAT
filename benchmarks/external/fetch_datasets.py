import json
import os
import subprocess
import urllib.request
import hashlib
import zipfile

DATASETS_JSON = "benchmarks/external/datasets.json"
DATA_DIR = "benchmarks/external/data"
VERIFICATION_MD = "benchmarks/external/dataset_verification.md"

def sha256_file(filepath):
    sha = hashlib.sha256()
    with open(filepath, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            sha.update(chunk)
    return sha.hexdigest()

def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATASETS_JSON, "r") as f:
        datasets = json.load(f)

    verification_log = ["# Dataset Verification\n"]

    # 1. Filter Synthetic Datasets
    new_synthetic = []
    for d in datasets.get("synthetic_datasets", []):
        if d["name"] == "OWASP CryptoAPI-Bench":
            print(f"Fetching {d['name']}...")
            repo_path = os.path.join(DATA_DIR, "CryptoAPI-Bench")
            if not os.path.exists(repo_path):
                try:
                    subprocess.run(["git", "clone", d["url"], repo_path], check=True)
                    head_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_path).decode().strip()
                    verification_log.append(f"- **{d['name']}**: Cloned from {d['url']} (HEAD: `{head_sha}`)\n")
                    new_synthetic.append(d)
                except subprocess.CalledProcessError:
                    verification_log.append(f"- **{d['name']}**: Failed to clone from {d['url']}\n")
            else:
                head_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_path).decode().strip()
                verification_log.append(f"- **{d['name']}**: Already cloned from {d['url']} (HEAD: `{head_sha}`)\n")
                new_synthetic.append(d)
        
        elif d["name"] == "Juliet":
            print(f"Fetching {d['name']}...")
            urls = {
                "c": "https://samate.nist.gov/SRD/testsuites/juliet/Juliet_Test_Suite_v1.3_for_C_Cpp.zip",
                "java": "https://samate.nist.gov/SRD/testsuites/juliet/Juliet_Test_Suite_v1.3_for_Java.zip"
            }
            d["cwes"] = ["CWE-327", "CWE-328", "CWE-326", "CWE-321", "CWE-329", "CWE-330", "CWE-780"]
            d["languages"] = ["c", "java"]
            
            for lang in d["languages"]:
                url = urls[lang]
                zip_path = os.path.join(DATA_DIR, f"Juliet_1.3_{lang}.zip")
                if not os.path.exists(zip_path):
                    try:
                        print(f"Downloading {url}...")
                        import socket
                        socket.setdefaulttimeout(10.0)
                        urllib.request.urlretrieve(url, zip_path)
                        print(f"Downloaded {url}")
                    except Exception as e:
                        print(f"Warning: Failed to fetch Juliet {lang}: {e}")
                        verification_log.append(f"- **Juliet ({lang})**: Failed to download from {url} ({e})\n")
                        continue
                        
                if os.path.exists(zip_path):
                    h = sha256_file(zip_path)
                    verification_log.append(f"- **Juliet ({lang})**: Downloaded from {url} (SHA256: `{h}`)\n")
                    # Unzip only the requested CWEs
                    extract_dir = os.path.join(DATA_DIR, f"Juliet_{lang}")
                    os.makedirs(extract_dir, exist_ok=True)
                    with zipfile.ZipFile(zip_path, 'r') as z:
                        for info in z.infolist():
                            # Only extract if path contains the CWE
                            if any(cwe.replace("-", "") in info.filename for cwe in d["cwes"]):
                                z.extract(info, extract_dir)
            
            new_synthetic.append(d)
        else:
            verification_log.append(f"- Dropped synthetic dataset: {d['name']}\n")

    datasets["synthetic_datasets"] = new_synthetic

    # 2. Filter Real Repositories
    new_real = []
    for r in datasets.get("real_repositories", []):
        url = r["url"]
        commit = r["commit"]
        name = r["name"]
        
        print(f"Verifying {name} at {url}...")
        ls_res = subprocess.run(["git", "ls-remote", url], capture_output=True, text=True)
        print(f"ls-remote finished with {ls_res.returncode}")
        if ls_res.returncode != 0:
            verification_log.append(f"- Dropped real repository: {name} (git ls-remote failed)\n")
            continue
            
        repo_path = os.path.join(DATA_DIR, name.replace(" ", "_"))
        if not os.path.exists(repo_path):
            os.makedirs(repo_path, exist_ok=True)
            subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)
            subprocess.run(["git", "remote", "add", "origin", url], cwd=repo_path, check=True, capture_output=True)
        print(f"Fetching {commit} for {name}...")
        fetch_res = subprocess.run(["git", "fetch", "--depth=1", "origin", commit], cwd=repo_path, capture_output=True, text=True)
        print(f"Fetch finished with {fetch_res.returncode}")
        if fetch_res.returncode != 0:
            verification_log.append(f"- Dropped real repository: {name} (git fetch {commit} failed)\n")
            continue
            
        verification_log.append(f"- **{name}**: Verified and fetched commit `{commit}` from {url}\n")
        subprocess.run(["git", "checkout", commit], cwd=repo_path, capture_output=True)
        new_real.append(r)

    datasets["real_repositories"] = new_real

    # Save verification log
    with open(VERIFICATION_MD, "w") as f:
        f.writelines(verification_log)

    # Save datasets.json
    with open(DATASETS_JSON, "w") as f:
        json.dump(datasets, f, indent=2)

if __name__ == "__main__":
    main()
