# Production Security Configuration Guide (Phase 24.3)

## 1. Executive Summary & Philosophy

ECDAT implements a **secure-by-default, fail-fast configuration architecture**. 

In production deployments:
1. **Unsafe development settings must never silently become production defaults.** If a placeholder, demo credential, localhost URL, or mock key is detected when running in production mode (`NODE_ENV=production`, `APP_ENV=production`, or `ECDAT_ENV=production`), the application or scanner **immediately halts startup with exit code 1**.
2. **Mandatory security configurations must be present.** Startup is blocked immediately if any required cryptographic key, database connection, or security policy flag is omitted.
3. **Debug and bypass flags are strictly prohibited.** Development flags that bypass authentication, skip TLS verification, or disable security scanners trigger instant termination.

---

## 2. Mandatory Production Security Configuration

The following parameters **MUST** be supplied in every production environment. If any of these are missing or empty, startup is rejected:

| Configuration Key | Minimum Requirements | Hardening Invariant | Failure Mode |
| :--- | :--- | :--- | :--- |
| `ECDAT_API_KEY` | Length $\ge$ 32 chars; high entropy | Cannot be `ecdat-demo-admin-key-2026` or start with `change-this-` / `test-` | Startup Blocked (`ERR_CONFIG_MANDATORY_MISSING` / `ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `DATA_ENCRYPTION_KEY` | Length $\ge$ 32 chars (256-bit key) | Cannot be `ecdat-dev-master-encryption-key` or weak default | Startup Blocked (`ERR_CONFIG_MANDATORY_MISSING` / `ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `DATABASE_URL` | Valid PostgreSQL URI with TLS (`sslmode=verify-full`) | Cannot target `localhost`, `127.0.0.1`, or use default `postgres:postgres` credentials | Startup Blocked (`ERR_CONFIG_MANDATORY_MISSING` / `ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `JWT_SECRET` | Length $\ge$ 32 chars; cryptographic random | Cannot use default or placeholder string | Startup Blocked (`ERR_CONFIG_MANDATORY_MISSING` / `ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `CORS_ORIGIN` | Comma-separated list of explicit `https://` origins | Cannot be wildcard `*`, cannot include `http://`, cannot include `localhost` | Startup Blocked (`ERR_CONFIG_MANDATORY_MISSING` / `ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `REQUIRE_AUTH_FOR_READS` | Explicit boolean `true` | Must be strictly `true` in production to prevent unauthenticated data leaks | Startup Blocked (`ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `DATABASE_SSL` | Explicit boolean `true` | Requires encrypted database transit (TLS 1.3) | Startup Blocked (`ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Explicit boolean `true` | Mitigates man-in-the-middle (MITM) attacks by rejecting invalid/unverified certificates | Startup Blocked (`ERR_CONFIG_UNSAFE_DEV_DEFAULT`) |

---

## 3. Blacklisted Development Credentials & Mock Settings

Both the Node.js backend (`backend/src/config/production_guard.js`) and the Python scanning engine (`scanners/production_config_guard.py`) maintain blacklists of insecure strings. If any production secret matches the blacklist or begins with a known test prefix, startup is aborted:

### Blacklisted Values
- `ecdat-demo-admin-key-2026`
- `ecdat-dev-master-encryption-key`
- `change-this-local-api-key`
- `change-this-local-postgres-password`
- `change-this-production-password`
- `change-this-local-key`
- `dummy-secret-key-for-testing`
- `super-secure-jwt-signing-key-example`
- `secret`, `password`, `admin`, `123456`, `default`, `root`, `test`, `dev`

### Prohibited Prefixes
- `change-this-*`
- `dummy*`
- `mock*`
- `test-*`

---

## 4. Prohibited Development Flags

The following bypass, debug, and mock flags are permitted strictly in local test environments. If any of these are enabled (`true`, `1`, `yes`, `on`) in a production environment, startup terminates immediately:

| Flag Name | Danger Prevented | Status in Production |
| :--- | :--- | :--- |
| `ALLOW_DEV_BYPASS` | Development authentication bypass backdoor | **FORBIDDEN** |
| `INSECURE_SKIP_VERIFY` | TLS certificate validation skipping | **FORBIDDEN** |
| `DISABLE_SECRETS_SCAN` | Disabling scanning of secrets in code | **FORBIDDEN** |
| `ALLOW_PLAINTEXT_COMMUNICATION` | Plaintext HTTP/DB communications | **FORBIDDEN** |
| `MOCK_INSPECTION_MODE` | Simulated / fake crypto inspection results | **FORBIDDEN** |
| `DEBUG_EXPOSE_STACK_TRACES` | Leaking internal error traces to API callers | **FORBIDDEN** |
| `ALLOW_INSECURE_DB_IN_PRODUCTION`| Unencrypted PostgreSQL connections in prod | **FORBIDDEN** |

---

## 5. Implementation Details

### Node.js Guard (`backend/src/config/production_guard.js` & `schema.js`)
- Executed during application bootstrap via `require("./config")`.
- Validates that mandatory keys are non-empty and satisfy entropy criteria.
- Throws specific structured errors:
  - `MissingMandatorySecurityConfigError` (`code: ERR_CONFIG_MANDATORY_MISSING`)
  - `UnsafeDevelopmentDefaultDetectedError` (`code: ERR_CONFIG_UNSAFE_DEV_DEFAULT`)
  - `InsecureProductionConfigError` (`code: ERR_CONFIG_INSECURE_PRODUCTION`)

### Python Guard (`scanners/production_config_guard.py`)
- Python scanner and worker security guard.
- Provides `ProductionConfigGuard.validate_environment()`.
- Provides CLI utility for CI/CD pre-flight checks:
  ```bash
  python scanners/production_config_guard.py --env production
  ```

---

## 6. Sample Production Configuration

### Kubernetes Secret (`ecdat-production-secrets.yaml`)
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ecdat-production-secrets
  namespace: ecdat-prod
type: Opaque
stringData:
  ECDAT_API_KEY: "prod-cluster-ecdat-api-key-9921471-enterprise-token"
  DATA_ENCRYPTION_KEY: "prod-aes256-dek-master-encryption-key-entropy-k8s"
  JWT_SECRET: "prod-jwt-signing-secret-key-32-chars-enterprise-k8s"
  DATABASE_URL: "postgresql://ecdat_svc:ProdP@ssw0rd991!@aurora-cluster.internal:5432/ecdat_prod?sslmode=verify-full"
```

### Kubernetes ConfigMap (`ecdat-production-config.yaml`)
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ecdat-production-config
  namespace: ecdat-prod
data:
  NODE_ENV: "production"
  APP_ENV: "production"
  PORT: "5000"
  CORS_ORIGIN: "https://console.ecdat.corp,https://api.ecdat.corp"
  REQUIRE_AUTH_FOR_READS: "true"
  DATABASE_SSL: "true"
  DATABASE_SSL_REJECT_UNAUTHORIZED: "true"
  ALLOW_DEV_BYPASS: "false"
  INSECURE_SKIP_VERIFY: "false"
```
