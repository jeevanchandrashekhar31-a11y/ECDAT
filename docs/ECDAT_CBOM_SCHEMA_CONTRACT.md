# ECDAT — CBOM Schema Contract (v1)

Every scanner (network, static code, binaries/containers) MUST emit output that
matches this contract. Format: **CycloneDX 1.6**, `cryptographic-asset`
component type. This is not our own invented schema — we are mapping our
findings onto the official public standard, which is exactly what a judge
will expect to see if they know the space.

Spec reference: https://cyclonedx.org/docs/1.6/json/
Cryptography registry (algorithm names/families): https://cyclonedx.org/registry/cryptography/

---

## 1. `bom-ref` naming convention (MANDATORY — prevents merge collisions)

```
<source>:<assetType>/<slug>@<locator>
```

- `source` — `net` (network scanner) | `code` (static scanner) | `bin` (binaries/containers)
- `assetType` — `algorithm` | `certificate` | `protocol` | `related-crypto-material`
- `slug` — short identifying name (e.g. `rsa-2048`, `md5`, `tls1.2`)
- `locator` — where it was found (`host:port` for network, `path:line` for code)

Examples:
- `net:algorithm/rsa-2048@api.example.com:443`
- `code:algorithm/md5@src/utils/hash.py:42`
- `net:protocol/tls1.2@api.example.com:443`

The source prefix guarantees no two scanners ever produce the same ID. Never
drop it, even for "obviously unique" names.

---

## 2. Required fields — every finding, no exceptions

| Field | Always required? | Notes |
|---|---|---|
| `type` | Yes | Always literally `"cryptographic-asset"` |
| `bom-ref` | Yes | Follow the convention above |
| `name` | Yes | Human-readable (e.g. `"RSA-2048"`, `"TLS 1.2"`) |
| `cryptoProperties.assetType` | Yes | `algorithm` \| `certificate` \| `protocol` \| `related-crypto-material` |
| matching `*Properties` object | Yes | See section 3 — must match `assetType` |
| `evidence.occurrences[].location` | Yes | Host:port or file path — this is what makes a finding auditable |
| `algorithmProperties.nistQuantumSecurityLevel` | Yes, for algorithm assets | 0 = not quantum-resistant, 1–5 = NIST PQC category. **This is the field the risk engine reads directly — do not skip it.** |

Optional / stretch (nice for the demo, not blocking): `oid`, `certificationLevel`, `cryptoFunctions`, `certificateExtensions`.

---

## 3. Network/Protocol Scanner — what you emit

Typical `assetType`s: `protocol`, `certificate`, `algorithm` (for the negotiated cipher/key exchange).

```json
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.6",
  "metadata": {
    "timestamp": "2026-08-29T00:00:00Z",
    "component": { "type": "application", "bom-ref": "net:target/api.example.com:443", "name": "api.example.com:443" }
  },
  "components": [
    {
      "type": "cryptographic-asset",
      "bom-ref": "net:protocol/tls1.2@api.example.com:443",
      "name": "TLS 1.2",
      "cryptoProperties": {
        "assetType": "protocol",
        "protocolProperties": {
          "type": "tls",
          "version": "1.2",
          "cipherSuites": ["TLS_RSA_WITH_AES_128_CBC_SHA"]
        }
      },
      "evidence": { "occurrences": [ { "location": "api.example.com:443", "additionalContext": "negotiated during TLS handshake" } ] }
    },
    {
      "type": "cryptographic-asset",
      "bom-ref": "net:certificate/api.example.com@443",
      "name": "api.example.com leaf certificate",
      "cryptoProperties": {
        "assetType": "certificate",
        "certificateProperties": {
          "subjectName": "CN=api.example.com",
          "issuerName": "CN=Example CA",
          "notValidBefore": "2026-01-01T00:00:00Z",
          "notValidAfter": "2027-01-01T00:00:00Z",
          "certificateFormat": "X.509"
        }
      },
      "evidence": { "occurrences": [ { "location": "api.example.com:443" } ] }
    },
    {
      "type": "cryptographic-asset",
      "bom-ref": "net:algorithm/rsa-2048@api.example.com:443",
      "name": "RSA-2048",
      "cryptoProperties": {
        "assetType": "algorithm",
        "algorithmProperties": {
          "primitive": "signature",
          "algorithmFamily": "RSA",
          "parameterSetIdentifier": "2048",
          "classicalSecurityLevel": 112,
          "nistQuantumSecurityLevel": 0
        }
      },
      "evidence": { "occurrences": [ { "location": "api.example.com:443" } ] }
    }
  ],
  "dependencies": [
    { "ref": "net:target/api.example.com:443", "dependsOn": ["net:protocol/tls1.2@api.example.com:443", "net:certificate/api.example.com@443"] }
  ]
}
```

---

## 4. Static Code Scanner — what you emit

Typical `assetType`s: `algorithm` (the large majority), `related-crypto-material` (hardcoded keys/secrets, if you catch any).

Use the generic `properties` array to carry your own extensions (confidence score,
detection method) — this keeps the document schema-valid while still giving the
risk engine what it needs from your Groq-verification pass on ambiguous matches.

```json
{
  "type": "cryptographic-asset",
  "bom-ref": "code:algorithm/md5@src/utils/hash.py:42",
  "name": "MD5",
  "cryptoProperties": {
    "assetType": "algorithm",
    "algorithmProperties": {
      "primitive": "hash",
      "algorithmFamily": "MD5",
      "classicalSecurityLevel": 0,
      "nistQuantumSecurityLevel": 0
    }
  },
  "evidence": {
    "occurrences": [ { "location": "src/utils/hash.py", "line": 42, "additionalContext": "hashlib.md5() call" } ]
  },
  "properties": [
    { "name": "ecdat:confidence", "value": "high" },
    { "name": "ecdat:detectionMethod", "value": "regex" }
  ]
}
```

For a match your regex/AST pass flagged but Groq had to confirm (indirect/wrapped
usage), set `"ecdat:detectionMethod": "llm-verified"` and lower confidence if the
model wasn't certain — the risk engine can then choose to down-weight or flag
those for manual review.

---

## 5. Merge rule (Backend/Role 4)

1. Concatenate all `components` arrays from every scanner's output file.
2. Reject (log, don't silently drop) any component whose `bom-ref` already
   exists — that means the naming convention was violated somewhere; fix the
   scanner, not the merge step.
3. Build one `dependencies` array linking the scanned target's root component
   to every crypto-asset `bom-ref` found for it.

## 6. Validation (set this up in CI before anyone writes scanner logic)

Validate every scanner's raw output against the official CycloneDX 1.6 JSON
Schema before it's allowed to merge:

- Schema source: https://github.com/CycloneDX/specification (schema/bom-1.6.schema.json)
- Any JSON Schema validator works (e.g. `check-jsonschema` in Python, or `ajv` in Node)
- Wire this as a GitHub Actions step that runs on every push — a scanner
  output that fails validation should fail the build, not get merged and
  silently break someone else's code three days later.
