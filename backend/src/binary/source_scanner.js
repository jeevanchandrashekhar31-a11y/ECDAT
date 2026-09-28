/**
 * ECDAT Real Source Code Scanner
 *
 * Walks a directory tree and extracts cryptographic API usage from actual source files.
 * Produces a standards-compliant CycloneDX 1.6 CBOM from real code evidence.
 *
 * Supported languages:
 *   - Python  (.py)   — cryptography, PyCryptodome, hashlib, ssl, paramiko, jwt
 *   - JavaScript/TypeScript (.js, .ts, .mjs, .cjs) — crypto, node-forge, jose, jsonwebtoken, tls
 *   - Go      (.go)   — crypto/*, golang.org/x/crypto
 *   - Java    (.java) — javax.crypto, java.security, BouncyCastle, JJWT
 *
 * Output: CycloneDX 1.6 CBOM object (same format as ingestCbom() expects)
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm detection patterns per language
// ─────────────────────────────────────────────────────────────────────────────

const PYTHON_PATTERNS = [
  // cryptography library
  { re: /from\s+cryptography\.hazmat\.primitives\.asymmetric\s+import\s+(\w+)/g, extract: (m) => ({ lib: "cryptography", usage: m[1] }) },
  { re: /from\s+cryptography\.hazmat\.primitives\.ciphers\s+import\s+(\w+)/g, extract: (m) => ({ lib: "cryptography", usage: m[1] }) },
  { re: /algorithms\.(\w+)\(/g, extract: (m) => ({ lib: "cryptography", algorithm: m[1] }) },
  { re: /padding\.(\w+)/g, extract: (m) => ({ lib: "cryptography", padding: m[1] }) },
  // PyCryptodome
  { re: /from\s+Crypto\.(?:PublicKey|Cipher|Hash|Signature)\s+import\s+(\w+)/g, extract: (m) => ({ lib: "PyCryptodome", algorithm: m[1] }) },
  { re: /Crypto\.(?:PublicKey|Cipher|Hash)\.(\w+)/g, extract: (m) => ({ lib: "PyCryptodome", algorithm: m[1] }) },
  // hashlib
  { re: /hashlib\.(\w+)\(/g, extract: (m) => ({ lib: "hashlib", algorithm: m[1] }) },
  { re: /hashlib\.new\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "hashlib", algorithm: m[1] }) },
  // ssl
  { re: /ssl\.PROTOCOL_(\w+)/g, extract: (m) => ({ lib: "ssl", algorithm: "TLS_" + m[1] }) },
  { re: /ssl\.OP_NO_(TLSv\d_\d)/g, extract: (m) => ({ lib: "ssl", algorithm: m[1].replace("_", ".") }) },
  // paramiko
  { re: /paramiko\.RSAKey|paramiko\.ECDSAKey|paramiko\.Ed25519Key/g, extract: (m) => ({ lib: "paramiko", algorithm: m[0].split(".")[1].replace("Key", "") }) },
  // PyJWT
  { re: /jwt\.encode\(.*algorithm=['"]([\w-]+)['"]/g, extract: (m) => ({ lib: "PyJWT", algorithm: m[1] }) },
  // oqs (OpenQuantumSafe)
  { re: /oqs\.KeyEncapsulation\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "liboqs-python", algorithm: m[1], isPQC: true }) },
  { re: /oqs\.Signature\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "liboqs-python", algorithm: m[1], isPQC: true }) },
  // key sizes from RSA.generate / generate_private_key
  { re: /RSA\.generate\((\d+)/g, extract: (m) => ({ lib: "PyCryptodome", algorithm: "RSA", keySize: parseInt(m[1]) }) },
  { re: /generate_private_key\([^,]+,\s*(\d+)/g, extract: (m) => ({ lib: "cryptography", algorithm: "RSA", keySize: parseInt(m[1]) }) },
];

const JS_PATTERNS = [
  // ── Node.js built-in crypto ──────────────────────────────────────────────
  { re: /crypto\.createCipher(?:iv)?\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:crypto", algorithm: m[1] }) },
  { re: /crypto\.createHash\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:crypto", algorithm: m[1], usage: "hash" }) },
  { re: /crypto\.createHmac\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:crypto", algorithm: "HMAC-" + m[1] }) },
  { re: /crypto\.generateKeyPair(?:Sync)?\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:crypto", algorithm: m[1] }) },
  { re: /crypto\.createSign\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:crypto", algorithm: m[1], usage: "signature" }) },
  { re: /crypto\.randomBytes\(/g, extract: () => ({ lib: "node:crypto", algorithm: "CSPRNG", usage: "key-generation" }) },
  { re: /crypto\.scrypt\(/g, extract: () => ({ lib: "node:crypto", algorithm: "scrypt", usage: "key-derivation" }) },
  { re: /crypto\.pbkdf2(?:Sync)?\(/g, extract: () => ({ lib: "node:crypto", algorithm: "PBKDF2", usage: "key-derivation" }) },
  { re: /modulusLength:\s*(\d+)/g, extract: (m) => ({ keySize: parseInt(m[1]) }) },
  { re: /namedCurve:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ algorithm: m[1] }) },
  // ── TLS / HTTPS ──────────────────────────────────────────────────────────
  { re: /tls\.createServer|https\.createServer/g, extract: () => ({ lib: "node:tls", algorithm: "TLS", usage: "server" }) },
  { re: /minVersion:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:tls", algorithm: m[1] }) },
  { re: /ciphers:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "node:tls", cipher_suite: m[1] }) },
  // ── JWT / Jose ───────────────────────────────────────────────────────────
  { re: /jwt\.sign\(/g, extract: () => ({ lib: "jsonwebtoken", algorithm: "JWT", usage: "jwt-signing" }) },
  { re: /jwt\.verify\(/g, extract: () => ({ lib: "jsonwebtoken", algorithm: "JWT", usage: "jwt-verification" }) },
  { re: /jwt\.decode\(/g, extract: () => ({ lib: "jsonwebtoken", algorithm: "JWT", usage: "jwt-decode" }) },
  { re: /sign\([^,]+,\s*[^,]+,\s*{[^}]*algorithm:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "jsonwebtoken", algorithm: m[1], usage: "jwt" }) },
  { re: /new\s+SignJWT|new\s+EncryptJWT/g, extract: () => ({ lib: "jose", usage: "jwt" }) },
  { re: /\.setProtectedHeader\(\s*{\s*alg:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "jose", algorithm: m[1] }) },
  { re: /expiresIn:\s*['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "jsonwebtoken", algorithm: "JWT", usage: "expiry-" + m[1] }) },
  { re: /JWT_SECRET|JWT_PRIVATE_KEY|TOKEN_SECRET/g, extract: () => ({ lib: "env-config", algorithm: "JWT", usage: "secret-config" }) },
  // ── Firebase Auth / Admin SDK ────────────────────────────────────────────
  { re: /admin\.auth\(\)|firebase-admin/g, extract: () => ({ lib: "firebase-admin", algorithm: "Firebase-Auth", usage: "identity" }) },
  { re: /getAuth\(\)|signInWithEmailAndPassword|createUserWithEmailAndPassword/g, extract: () => ({ lib: "firebase/auth", algorithm: "Firebase-Auth", usage: "authentication" }) },
  { re: /admin\.credential\.cert\(/g, extract: () => ({ lib: "firebase-admin", algorithm: "Service-Account-JWT", usage: "service-auth" }) },
  { re: /verifyIdToken\(/g, extract: () => ({ lib: "firebase-admin", algorithm: "RS256-JWT", usage: "token-verification" }) },
  { re: /FIREBASE_SERVICE_ACCOUNT|FIREBASE_PRIVATE_KEY/g, extract: () => ({ lib: "env-config", algorithm: "Firebase-RSA", usage: "service-account" }) },
  // ── Prisma / Database ────────────────────────────────────────────────────
  { re: /new\s+PrismaClient/g, extract: () => ({ lib: "prisma", algorithm: "Database-TLS", usage: "db-connection" }) },
  { re: /prisma\.\$connect|DATABASE_URL/g, extract: () => ({ lib: "prisma", algorithm: "Database-TLS", usage: "db-connection" }) },
  { re: /@db\.Text|@encrypt/g, extract: () => ({ lib: "prisma", algorithm: "Field-Encryption", usage: "data-at-rest" }) },
  // ── Redis ────────────────────────────────────────────────────────────────
  { re: /createClient|new\s+Redis\(/g, extract: () => ({ lib: "redis", algorithm: "Redis-TLS", usage: "cache-connection" }) },
  { re: /REDIS_URL|REDIS_PASSWORD|rediss:\/\//g, extract: () => ({ lib: "env-config", algorithm: "Redis-TLS", usage: "connection-string" }) },
  // ── Passport.js / OAuth ──────────────────────────────────────────────────
  { re: /passport\.use\(|new\s+LocalStrategy/g, extract: () => ({ lib: "passport", algorithm: "Password-Auth", usage: "authentication" }) },
  { re: /new\s+JwtStrategy|passport-jwt/g, extract: () => ({ lib: "passport-jwt", algorithm: "JWT", usage: "authentication" }) },
  { re: /new\s+OAuth2Strategy|passport-oauth2/g, extract: () => ({ lib: "passport-oauth2", algorithm: "OAuth2", usage: "authorization" }) },
  { re: /new\s+GoogleStrategy|new\s+GitHubStrategy|new\s+FacebookStrategy/g, extract: () => ({ lib: "passport-oauth", algorithm: "OIDC-OAuth2", usage: "social-auth" }) },
  // ── Password hashing ─────────────────────────────────────────────────────
  { re: /bcrypt\.hash|bcrypt\.hashSync|bcryptjs\.hash/g, extract: () => ({ lib: "bcrypt", algorithm: "bcrypt", usage: "password-hash" }) },
  { re: /bcrypt\.compare|bcrypt\.compareSync/g, extract: () => ({ lib: "bcrypt", algorithm: "bcrypt", usage: "password-verify" }) },
  { re: /argon2\.hash/g, extract: () => ({ lib: "argon2", algorithm: "argon2id", usage: "password-hash" }) },
  // ── Session / Cookies ────────────────────────────────────────────────────
  { re: /express-session|session\({[^}]*secret/g, extract: () => ({ lib: "express-session", algorithm: "HMAC-SHA256", usage: "session" }) },
  { re: /cookie-parser|cookieParser\(/g, extract: () => ({ lib: "cookie-parser", algorithm: "Cookie-Signing", usage: "session" }) },
  { re: /SESSION_SECRET|COOKIE_SECRET/g, extract: () => ({ lib: "env-config", algorithm: "HMAC", usage: "session-secret" }) },
  // ── Helmet / CSP ─────────────────────────────────────────────────────────
  { re: /helmet\(|helmet\.contentSecurityPolicy/g, extract: () => ({ lib: "helmet", algorithm: "HTTP-Security-Headers", usage: "transport-security" }) },
  // ── CORS / Rate limiting ─────────────────────────────────────────────────
  { re: /cors\(|rate-limit|rateLimit\(/g, extract: () => ({ lib: "express-middleware", algorithm: "Access-Control", usage: "api-protection" }) },
  // ── AWS SDK ──────────────────────────────────────────────────────────────
  { re: /KMSClient|SecretsManagerClient|SSMClient/g, extract: () => ({ lib: "aws-sdk", algorithm: "AWS-KMS", usage: "key-management" }) },
  { re: /new\s+KMS\(|kms\.encrypt|kms\.decrypt/g, extract: () => ({ lib: "aws-sdk-v2", algorithm: "AWS-KMS", usage: "encryption" }) },
  { re: /AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID/g, extract: () => ({ lib: "env-config", algorithm: "AWS-SigV4", usage: "api-signing" }) },
  // ── Google Cloud ─────────────────────────────────────────────────────────
  { re: /KeyManagementServiceClient|@google-cloud\/kms/g, extract: () => ({ lib: "google-cloud-kms", algorithm: "GCP-KMS", usage: "key-management" }) },
  { re: /GOOGLE_APPLICATION_CREDENTIALS/g, extract: () => ({ lib: "env-config", algorithm: "GCP-ServiceAccount", usage: "auth" }) },
  // ── Azure ────────────────────────────────────────────────────────────────
  { re: /KeyClient|CryptographyClient|@azure\/keyvault/g, extract: () => ({ lib: "azure-keyvault", algorithm: "Azure-KMS", usage: "key-management" }) },
  // ── node-forge ───────────────────────────────────────────────────────────
  { re: /forge\.pki\.rsa\.generateKeyPair/g, extract: () => ({ lib: "node-forge", algorithm: "RSA" }) },
  { re: /forge\.tls\.|forge\.ssl\./g, extract: () => ({ lib: "node-forge", usage: "tls" }) },
  // ── Next-Auth / Auth.js ──────────────────────────────────────────────────
  { re: /NextAuth\(|import.*next-auth|NEXTAUTH_SECRET/g, extract: () => ({ lib: "next-auth", algorithm: "OAuth2-OIDC", usage: "authentication" }) },
  // ── Stripe ───────────────────────────────────────────────────────────────
  { re: /new\s+Stripe\(|STRIPE_SECRET_KEY/g, extract: () => ({ lib: "stripe", algorithm: "TLS-AES256", usage: "payment-security" }) },
  // ── Email sending (transport TLS) ────────────────────────────────────────
  { re: /nodemailer|createTransport|SENDGRID_API_KEY|SMTP_/g, extract: () => ({ lib: "nodemailer", algorithm: "SMTP-TLS", usage: "email-transport" }) },
  // ── Generic secret patterns ───────────────────────────────────────────────
  { re: /process\.env\.(SECRET|PRIVATE_KEY|API_KEY|AUTH_KEY|SIGNING_KEY|ENCRYPTION_KEY)/g, extract: (m) => ({ lib: "env-config", algorithm: "Secret-Key", usage: m[1].toLowerCase() }) },
];


const GO_PATTERNS = [
  { re: /"crypto\/(rsa|ecdsa|ecdh|ed25519|dsa)"/g, extract: (m) => ({ lib: "stdlib", algorithm: m[1].toUpperCase() }) },
  { re: /"crypto\/(sha256|sha512|sha1|md5)"/g, extract: (m) => ({ lib: "stdlib", algorithm: m[1].toUpperCase(), usage: "hash" }) },
  { re: /"crypto\/(aes|des|rc4|chacha20)"/g, extract: (m) => ({ lib: "stdlib", algorithm: m[1].toUpperCase() }) },
  { re: /"crypto\/tls"/g, extract: () => ({ lib: "stdlib", algorithm: "TLS" }) },
  { re: /tls\.VersionTLS(\d+)/g, extract: (m) => ({ lib: "stdlib", algorithm: "TLS 1." + (m[1] === "13" ? "3" : m[1] === "12" ? "2" : m[1]) }) },
  { re: /"golang\.org\/x\/crypto\/(chacha20poly1305|curve25519|nacl|ed25519|bcrypt|argon2)"/g, extract: (m) => ({ lib: "golang.org/x/crypto", algorithm: m[1] }) },
  { re: /rsa\.GenerateKey\(.*?,\s*(\d+)/g, extract: (m) => ({ lib: "stdlib", algorithm: "RSA", keySize: parseInt(m[1]) }) },
  { re: /elliptic\.(P256|P384|P521|P224)\(\)/g, extract: (m) => ({ lib: "stdlib", algorithm: "ECDSA", curve: m[1] }) },
  // go-jose / liboqs-go
  { re: /"github\.com\/go-jose\/go-jose\/v\d"/g, extract: () => ({ lib: "go-jose", usage: "jwt" }) },
  { re: /"github\.com\/open-quantum-safe\/liboqs-go"/g, extract: () => ({ lib: "liboqs-go", isPQC: true }) },
];

const JAVA_PATTERNS = [
  { re: /KeyPairGenerator\.getInstance\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "javax.crypto", algorithm: m[1] }) },
  { re: /Cipher\.getInstance\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "javax.crypto", algorithm: m[1].split("/")[0], mode: m[1].split("/")[1], padding: m[1].split("/")[2] }) },
  { re: /MessageDigest\.getInstance\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "java.security", algorithm: m[1], usage: "hash" }) },
  { re: /Mac\.getInstance\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "javax.crypto", algorithm: m[1] }) },
  { re: /SSLContext\.getInstance\(['"]([^'"]+)['"]/g, extract: (m) => ({ lib: "javax.net.ssl", algorithm: m[1] }) },
  { re: /initialize\((\d+)/g, extract: (m) => ({ keySize: parseInt(m[1]) }) },
  // BouncyCastle
  { re: /import\s+org\.bouncycastle\.crypto\..*\.([\w]+Algorithm|[\w]+Generator)/g, extract: (m) => ({ lib: "BouncyCastle", usage: m[1] }) },
  { re: /new\s+PKCS8Generator|new\s+JcaPKCS10CertificationRequestBuilder/g, extract: () => ({ lib: "BouncyCastle", usage: "pki" }) },
  // JJWT
  { re: /Jwts\.builder\(\)|Jwts\.parserBuilder\(\)/g, extract: () => ({ lib: "JJWT", usage: "jwt" }) },
  { re: /SignatureAlgorithm\.(\w+)/g, extract: (m) => ({ lib: "JJWT", algorithm: m[1] }) },
];

const C_PATTERNS = [
  { re: /\b(md5|MD5|EVP_md5)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "MD5", usage: "hash" }) },
  { re: /\b(sha1|SHA1|EVP_sha1)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "SHA-1", usage: "hash" }) },
  { re: /\b(des|DES|EVP_des)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "DES", usage: "cipher" }) },
  { re: /\b(des3|DES3|des_ede|EVP_des_ede)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "3DES", usage: "cipher" }) },
  { re: /\b(rc2|RC2|EVP_rc2)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "RC2", usage: "cipher" }) },
  { re: /\b(rc4|RC4|EVP_rc4)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "RC4", usage: "cipher" }) },
  { re: /\b(ecb|ECB)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "ECB_Mode", usage: "cipher_mode" }) },
  { re: /\b(?:RSA_generate_key(?:_ex)?|RSA\.generate)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "RSA", usage: "key-generation" }) },
  { re: /\b(ECDH|ecdh|ECDHE|ec_key_new_by_curve_name)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "ECDH", usage: "key-exchange" }) },
  { re: /\b(rand|srand)\b/g, extract: () => ({ lib: "c-stdlib", algorithm: "Weak_PRNG", usage: "prng" }) },
  { re: /\b(openssl|mbedtls|wolfssl|libsodium)\b/g, extract: (m) => ({ lib: m[1], algorithm: "Crypto_Library", usage: "import" }) },
];

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm normalizer — maps raw detections to canonical names
// ─────────────────────────────────────────────────────────────────────────────

const ALGO_NORMALIZE = {
  rsa: "RSA", RSA: "RSA", "RSAKey": "RSA",
  ecdsa: "ECDSA", ECDSA: "ECDSA", ec: "ECDSA",
  ecdh: "ECDH", ECDH: "ECDH",
  ed25519: "Ed25519", Ed25519: "Ed25519",
  aes: "AES", AES: "AES", "AES-128": "AES-128", "AES-256": "AES-256",
  "aes-128-cbc": "AES-128-CBC", "aes-256-cbc": "AES-256-CBC",
  "aes-128-gcm": "AES-128-GCM", "aes-256-gcm": "AES-256-GCM",
  "3des": "3DES", des: "DES", "DES3": "3DES", "TripleDES": "3DES",
  rc4: "RC4", RC4: "RC4",
  sha1: "SHA-1", SHA1: "SHA-1", "SHA-1": "SHA-1",
  sha256: "SHA-256", SHA256: "SHA-256", "SHA-256": "SHA-256",
  sha384: "SHA-384", SHA384: "SHA-384",
  sha512: "SHA-512", SHA512: "SHA-512",
  md5: "MD5", MD5: "MD5",
  "TLSv1": "TLS 1.0", "TLSv1_1": "TLS 1.1", "TLSv1_2": "TLS 1.2", "TLSv1_3": "TLS 1.3",
  "TLS": "TLS", "SSLv3": "SSL 3.0",
  "ML-KEM-512": "ML-KEM-512", "ML-KEM-768": "ML-KEM-768", "ML-KEM-1024": "ML-KEM-1024",
  "ML-DSA-44": "ML-DSA-44", "ML-DSA-65": "ML-DSA-65", "ML-DSA-87": "ML-DSA-87",
  "Kyber512": "ML-KEM-512", "Kyber768": "ML-KEM-768", "Kyber1024": "ML-KEM-1024",
  "Dilithium2": "ML-DSA-44", "Dilithium3": "ML-DSA-65", "Dilithium5": "ML-DSA-87",
  "SPHINCS+": "SLH-DSA", "SLH-DSA": "SLH-DSA",
  bcrypt: "bcrypt", argon2id: "argon2id", "PBKDF2": "PBKDF2",
  chacha20poly1305: "ChaCha20-Poly1305", chacha20: "ChaCha20",
  "P256": "ECDSA-P256", "P384": "ECDSA-P384", "P521": "ECDSA-P521",
};

function normalizeAlgorithm(raw) {
  if (!raw) return null;
  return ALGO_NORMALIZE[raw] || ALGO_NORMALIZE[raw.toLowerCase()] || raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// File traversal
// ─────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "__pycache__", "venv", "env",
  "dist", "build", "target", "vendor", ".gradle", ".mvn", "coverage",
]);

const LANG_MAP = {
  ".c": { lang: "c", patterns: C_PATTERNS },
  ".h": { lang: "c", patterns: C_PATTERNS },
  ".cpp": { lang: "cpp", patterns: C_PATTERNS },
  ".hpp": { lang: "cpp", patterns: C_PATTERNS },
  ".cc": { lang: "cpp", patterns: C_PATTERNS },
  ".py": { lang: "python", patterns: PYTHON_PATTERNS },
  ".js": { lang: "javascript", patterns: JS_PATTERNS },
  ".mjs": { lang: "javascript", patterns: JS_PATTERNS },
  ".cjs": { lang: "javascript", patterns: JS_PATTERNS },
  ".ts": { lang: "typescript", patterns: JS_PATTERNS },
  ".tsx": { lang: "typescript", patterns: JS_PATTERNS },
  ".go": { lang: "go", patterns: GO_PATTERNS },
  ".java": { lang: "java", patterns: JAVA_PATTERNS },
};

function* walkDir(dir, maxDepth = 12, depth = 0) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full, maxDepth, depth + 1);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (LANG_MAP[ext]) yield { filePath: full, ext, ...LANG_MAP[ext] };
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractFromFile(filePath, patterns, lang) {
  let content;
  try { content = fs.readFileSync(filePath, "utf8"); } catch { return []; }

  const findings = [];
  const lines = content.split("\n");

  for (const { re, extract } of patterns) {
    const regex = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let match;
    while ((match = regex.exec(content)) !== null) {
      try {
        const info = extract(match);
        if (!info) continue;

        // Determine line number from match index
        const lineNumber = content.slice(0, match.index).split("\n").length;
        const lineContent = lines[lineNumber - 1]?.trim() || "";

        const algorithm = normalizeAlgorithm(info.algorithm || info.usage);
        if (!algorithm) continue;

        findings.push({
          algorithm,
          rawMatch: match[0].slice(0, 120),
          library: info.lib || "unknown",
          keySize: info.keySize || null,
          usage: info.usage || null,
          isPQC: info.isPQC || false,
          filePath,
          lineNumber,
          evidence: lineContent.slice(0, 200),
          lang,
        });
      } catch { /* skip malformed match */ }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CBOM builder — CycloneDX 1.6 format
// ─────────────────────────────────────────────────────────────────────────────

function buildCbom(scanPath, allFindings, options = {}) {
  const scanId = `scan_src_${crypto.randomUUID()}`;
  const components = [];
  const componentMap = new Map();

  for (const f of allFindings) {
    const key = `${f.algorithm}|${f.library}|${f.keySize || ""}`;
    const bomRef = `${key.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}-${components.length}`;

    const component = {
      type: "cryptographic-asset",
      name: f.algorithm,
      bomRef,
      version: f.keySize ? `${f.keySize}-bit` : undefined,
      properties: [
        { name: "ecdat:library", value: f.library },
        { name: "ecdat:language", value: f.lang },
        { name: "ecdat:sourceFile", value: path.relative(scanPath, f.filePath) },
        { name: "ecdat:lineNumber", value: String(f.lineNumber) },
        { name: "ecdat:evidence", value: f.evidence },
      ].filter(Boolean),
      cryptoProperties: {
        assetType: "algorithm",
        algorithmProperties: {
          primitive: inferPrimitive(f.algorithm),
          ...(f.keySize ? { parameterSetIdentifier: String(f.keySize) } : {}),
        },
      },
      evidence: {
        occurrences: [{
          location: path.relative(scanPath, f.filePath),
          line: f.lineNumber,
          symbol: f.rawMatch,
        }],
      },
    };

    if (!componentMap.has(key)) {
      componentMap.set(key, component);
      components.push(component);
    } else {
      const existingComponent = componentMap.get(key);
      // Cap occurrences to prevent unbounded memory growth on massive repos
      if (existingComponent.evidence.occurrences.length < 50000) {
        existingComponent.evidence.occurrences.push({
          location: path.relative(scanPath, f.filePath),
          line: f.lineNumber,
          symbol: f.rawMatch,
        });
      }
    }
  }

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: "ECDAT", name: "Source Code Scanner", version: "2.0.0" }],
      component: {
        type: "application",
        name: options.projectName || path.basename(scanPath),
        description: `Source code scan of ${scanPath}`,
      },
    },
    components,
    _scanMeta: {
      scanId,
      scanPath,
      totalFilesScanned: options.totalFiles || 0,
      totalFindingsRaw: allFindings.length,
      totalComponents: components.length,
      languages: [...new Set(allFindings.map((f) => f.lang))],
    },
  };
}

function inferPrimitive(algorithm) {
  if (!algorithm) return "other";
  const a = algorithm.toUpperCase();
  if (/^RSA|^DSA|^DH$/.test(a)) return "public-key-encryption";
  if (/^ECDSA|^EC$|^Ed25519|^Ed448/.test(a)) return "signature";
  if (/^ECDH|^X25519|^X448/.test(a)) return "key-agreement";
  if (/^AES|^DES|^3DES|^RC4|CHACHA/.test(a)) return "block-cipher";
  if (/^SHA|^MD5|^BLAKE/.test(a)) return "hash";
  if (/^HMAC/.test(a)) return "mac";
  if (/^ML-KEM|Kyber/.test(a)) return "key-encapsulation-mechanism";
  if (/^ML-DSA|Dilithium|^SLH-DSA|SPHINCS/.test(a)) return "signature";
  if (/^TLS|^SSL/.test(a)) return "protocol";
  if (/^bcrypt|argon2|^PBKDF/.test(a)) return "password-based-key-derivation-function";
  return "other";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan function — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans a source directory and produces a CycloneDX 1.6 CBOM.
 *
 * @param {string} scanPath - Absolute path to directory to scan
 * @param {object} [options]
 * @param {string} [options.projectName] - Project name for CBOM metadata
 * @param {number} [options.maxFiles=5000] - Cap file count to avoid runaway scans
 * @returns {{ cbom: object, stats: object }}
 */
function scanSourceDirectory(scanPath, options = {}) {
  if (!fs.existsSync(scanPath)) {
    throw new Error(`Scan path does not exist: ${scanPath}`);
  }

  const stat = fs.statSync(scanPath);
  if (!stat.isDirectory()) {
    throw new Error(`Scan path must be a directory: ${scanPath}`);
  }

  const maxFiles = options.maxFiles || 5000;
  const allFindings = [];
  let totalFiles = 0;

  for (const fileInfo of walkDir(scanPath)) {
    if (totalFiles >= maxFiles) break;
    totalFiles++;
    const findings = extractFromFile(fileInfo.filePath, fileInfo.patterns, fileInfo.lang);
    allFindings.push(...findings);
  }

  const cbom = buildCbom(scanPath, allFindings, { ...options, totalFiles });

  return {
    cbom,
    stats: {
      totalFiles,
      totalFindingsRaw: allFindings.length,
      totalComponents: cbom.components.length,
      languages: cbom._scanMeta.languages,
      pqcComponents: cbom.components.filter((c) =>
        c.properties?.some((p) => p.name === "ecdat:isPQC" && p.value === "true")
      ).length,
    },
  };
}

module.exports = { scanSourceDirectory, buildCbom, extractFromFile, LANG_MAP, SKIP_DIRS };
