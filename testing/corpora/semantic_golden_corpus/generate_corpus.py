import os
import json

base_dir = "testing/corpora/semantic_golden_corpus"

tp_files = {
    "01_xor_stream.py": """def encrypt(data, key):
    res = []
    for i in range(len(data)):
        res.append(chr(ord(data[i]) ^ ord(key[i % len(key)])))
    return "".join(res)
""",
    "02_caesar.c": """void caesar_cipher(char* text, int shift) {
    for (int i=0; text[i] != '\\0'; i++) {
        text[i] = (text[i] + shift) % 256;
    }
}""",
    "03_vigenere.js": """function vigenere(text, key) {
    let out = '';
    for(let i=0; i<text.length; i++) {
        let k = key.charCodeAt(i % key.length);
        out += String.fromCharCode(text.charCodeAt(i) ^ k);
    }
    return out;
}""",
    "04_custom_hash.py": """def my_hash(data):
    h = 0x12345678
    for char in data:
        h = (h << 5) + h + ord(char)
        h ^= 0x55555555
    return h""",
    "05_bit_rotation.go": """func rotate_encrypt(data []byte) {
    for i := 0; i < len(data); i++ {
        data[i] = (data[i] << 3) | (data[i] >> 5)
        data[i] ^= 0xAA
    }
}""",
    "06_custom_kdf.java": """public byte[] deriveKey(String pass) {
    byte[] key = new byte[16];
    for(int i=0; i<pass.length(); i++) {
        key[i%16] ^= (byte)(pass.charAt(i) << 1);
    }
    return key;
}""",
    "07_modular_exponentiation.py": """def encrypt_num(m, e, n):
    res = 1
    m = m % n
    while e > 0:
        if (e & 1) == 1:
            res = (res * m) % n
        e = e >> 1
        m = (m * m) % n
    return res""",
    "08_feistel_network.c": """void feistel_round(uint32_t* L, uint32_t* R, uint32_t k) {
    uint32_t temp = *L;
    *L = *R ^ ((*L << 4) + k);
    *R = temp;
}"""
}

tn_files = {
    "01_crc32.c": """uint32_t crc32(const uint8_t *data, size_t length) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (int j = 0; j < 8; j++) {
            crc = (crc >> 1) ^ (0xEDB88320 & (-(crc & 1)));
        }
    }
    return ~crc;
}""",
    "02_hash_table.py": """def str_hash(s):
    # Standard djb2 hash for a hash table (NOT crypto)
    h = 5381
    for c in s:
        h = ((h << 5) + h) + ord(c)
    return h""",
    "03_rle_compress.js": """function rle_compress(str) {
    let out = '';
    let count = 1;
    for(let i=1; i<=str.length; i++) {
        if(str[i] === str[i-1]) count++;
        else { out += str[i-1] + count; count = 1; }
    }
    return out;
}""",
    "04_rgb_invert.py": """def invert_colors(pixels):
    for i in range(len(pixels)):
        pixels[i] = pixels[i] ^ 0xFFFFFF # Invert bits for color swap
    return pixels""",
    "05_random_lfsr.go": """func lfsr(seed uint16) uint16 {
    bit := ((seed >> 0) ^ (seed >> 2) ^ (seed >> 3) ^ (seed >> 5)) & 1
    return (seed >> 1) | (bit << 15)
}""",
    "06_base64_encode.c": """void base64_chunk(const uint8_t* in, char* out) {
    out[0] = b64_table[in[0] >> 2];
    out[1] = b64_table[((in[0] & 0x03) << 4) | (in[1] >> 4)];
    out[2] = b64_table[((in[1] & 0x0F) << 2) | (in[2] >> 6)];
    out[3] = b64_table[in[2] & 0x3F];
}""",
    "07_murmur_hash.java": """public int murmur3(int key) {
    key ^= key >>> 16;
    key *= 0x85ebca6b;
    key ^= key >>> 13;
    key *= 0xc2b2ae35;
    key ^= key >>> 16;
    return key;
}""",
    "08_bit_flags.py": """def process_flags(flags):
    if flags & 0x01:
        flags ^= 0x02
    flags = flags << 1
    return flags"""
}

edge_cases = {
    "01_mixed_crypto.py": """import hashlib
def custom_hmac(data, key):
    # Uses a real library but incorrectly adds a custom XOR step
    h = hashlib.sha256(data).digest()
    return bytes([a ^ b for a, b in zip(h, key)])
""",
    "02_short_snippet.c": """void process(int* a) {
    *a ^= 0x1234;
}"""
}

manifest = {
    "files": {}
}

for name, content in tp_files.items():
    with open(f"{base_dir}/01_true_positives/{name}", "w") as f:
        f.write(content)
    manifest["files"][f"01_true_positives/{name}"] = {"expected": "LIKELY_CUSTOM_CRYPTO", "category": "True Positive"}

for name, content in tn_files.items():
    with open(f"{base_dir}/02_true_negatives/{name}", "w") as f:
        f.write(content)
    manifest["files"][f"02_true_negatives/{name}"] = {"expected": "LIKELY_NON_CRYPTO_BITWISE_LOGIC", "category": "True Negative"}

for name, content in edge_cases.items():
    with open(f"{base_dir}/03_edge_cases/{name}", "w") as f:
        f.write(content)
    # The mixed one is definitely custom crypto, the short one is insufficient context
    expected = "LIKELY_CUSTOM_CRYPTO" if "mixed" in name else "INSUFFICIENT_CONTEXT"
    manifest["files"][f"03_edge_cases/{name}"] = {"expected": expected, "category": "Edge Case"}

with open(f"{base_dir}/manifest.json", "w") as f:
    json.dump(manifest, f, indent=4)
