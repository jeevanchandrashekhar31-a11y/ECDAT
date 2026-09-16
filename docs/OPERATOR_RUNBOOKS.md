# ECDAT Production Operator Runbooks (Phase 25.3)

This operational manual provides step-by-step runbooks for platform engineers, SREs, and SecOps teams operating ECDAT in production.

---

## Quick Reference Index

1. [RB-01: System Installation](#rb-01-system-installation)
2. [RB-02: Zero-Downtime Upgrades](#rb-02-zero-downtime-upgrades)
3. [RB-03: Backup and Disaster Recovery](#rb-03-backup-and-disaster-recovery)
4. [RB-04: Security Incident Response](#rb-04-security-incident-response)
5. [RB-05: Discovery Scanner Failure](#rb-05-discovery-scanner-failure)
6. [RB-06: Compromised Credential Protocol](#rb-06-compromised-credential-protocol)
7. [RB-07: eBPF Runtime Subsystem Failure](#rb-07-ebpf-runtime-subsystem-failure)
8. [RB-08: Database Outage and Recovery](#rb-08-database-outage-and-recovery)
9. [RB-09: Certificate & PKI Anomalies](#rb-09-certificate--pki-anomalies)
10. [RB-10: External Integration Outages (SIEM / KMS / Ticketing)](#rb-10-external-integration-outages-siem--kms--ticketing)
11. [RB-11: Emergency Rollback Procedure](#rb-11-emergency-rollback-procedure)

---

## RB-01: System Installation

### 1. Overview & Prerequisites
Deploys the complete ECDAT cryptographic posture management platform into enterprise Kubernetes or Docker environments.
- **Kubernetes Version**: 1.28+ (Dual namespace support, Pod Security Standards).
- **Tools Required**: `kubectl`, `helm` 3.12+, `openssl` 3.0+, `jq`.
- **Compute Sizing**:
  - Backend: 2 replicas, 1 CPU, 1Gi RAM per pod.
  - Frontend: 2 replicas, 0.5 CPU, 512Mi RAM per pod.
  - PostgreSQL 16: 1 replica, 2 CPU, 4Gi RAM, 20Gi NVMe PVC.
  - eBPF Agent: DaemonSet (1 per Linux node with kernel $\ge$ 5.8).

### 2. Step-by-Step Procedure (Production Helm)

#### Step 1: Provision Production Secrets
Generate high-entropy keys (minimum 32 characters/bytes for 256-bit security):
```bash
# Generate high-entropy master secrets
ECDAT_API_KEY=$(openssl rand -hex 32)
DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)

# Create control plane namespace
kubectl create namespace ecdat-control-plane
kubectl label namespace ecdat-control-plane pod-security.kubernetes.io/enforce=restricted

# Create production secret in Kubernetes
kubectl create secret generic ecdat-production-secrets \
  --namespace ecdat-control-plane \
  --from-literal=ECDAT_API_KEY="${ECDAT_API_KEY}" \
  --from-literal=DATA_ENCRYPTION_KEY="${DATA_ENCRYPTION_KEY}" \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=POSTGRES_PASSWORD="${DB_PASSWORD}" \
  --from-literal=DATABASE_URL="postgresql://ecdat_app:${DB_PASSWORD}@ecdat-postgres.ecdat-control-plane.svc.cluster.local:5432/ecdat_prod?sslmode=verify-full"
```

#### Step 2: Deploy via Helm
```bash
helm install ecdat deploy/helm/ecdat \
  --namespace ecdat-control-plane \
  --set global.environment=production \
  --set backend.env.NODE_ENV=production \
  --set backend.env.REQUIRE_AUTH_FOR_READS=true \
  --set backend.env.DATABASE_SSL=true \
  --set backend.env.CORS_ORIGIN="https://console.ecdat.corp,https://api.ecdat.corp" \
  --wait --timeout 5m
```

#### Step 3: Deploy Runtime eBPF DaemonSet (Optional Runtime Telemetry)
```bash
kubectl create namespace ecdat-runtime
kubectl label namespace ecdat-runtime pod-security.kubernetes.io/enforce=privileged

kubectl apply -f deploy/k8s/09-ebpf-agent-daemonset.yaml
```

### 3. Verification
```bash
# Verify all pods are running and healthy
kubectl get pods -n ecdat-control-plane
kubectl get pods -n ecdat-runtime

# Verify backend health endpoint
curl -sSf https://api.ecdat.corp/health | jq .
```

---

## RB-02: Zero-Downtime Upgrades

### 1. Symptoms & Purpose
Execute software, rule, or database schema upgrades without terminating user sessions or losing in-flight scans.

### 2. Pre-Upgrade Checklist
1. Verify backup exists (see [RB-03](#rb-03-backup-and-disaster-recovery)).
2. Inspect migration changelog in `backend/migrations/`.
3. Check release gate artifact signatures (`python scripts/sign_artifacts.py --verify`).

### 3. Upgrade Procedure
```bash
# Step 1: Run database migration pre-flight check in a one-shot job
kubectl run ecdat-migration-check \
  --namespace ecdat-control-plane \
  --image=ecdat-backend:v1.1.0 \
  --restart=Never \
  --rm -i -- npm run migrate:status

# Step 2: Execute Helm upgrade with rolling deployment (maxSurge=25%, maxUnavailable=0)
helm upgrade ecdat deploy/helm/ecdat \
  --namespace ecdat-control-plane \
  --set backend.image.tag=v1.1.0 \
  --set frontend.image.tag=v1.1.0 \
  --reuse-values \
  --wait --timeout 6m

# Step 3: Verify rollout completion
kubectl rollout status deployment/ecdat-backend -n ecdat-control-plane
kubectl rollout status deployment/ecdat-frontend -n ecdat-control-plane
```

### 4. Post-Upgrade Verification
```bash
# Check version in health response
curl -sSf https://api.ecdat.corp/health | jq .version
```

---

## RB-03: Backup and Disaster Recovery

### 1. Overview
ECDAT provides automated, authenticated AES-256-GCM database snapshotting with SHA-256 integrity verification.

### 2. Manual Backup Trigger (API & CLI)
```bash
# Trigger an authenticated encrypted backup via API
BACKUP_RESP=$(curl -sSf -X POST "https://api.ecdat.corp/api/v1/security/database/backups" \
  -H "X-API-Key: ${ECDAT_API_KEY}" \
  -H "Content-Type: application/json")

BACKUP_ID=$(echo "${BACKUP_RESP}" | jq -r .backup.backupId)
echo "Backup Created: ${BACKUP_ID}"

# Verify backup archive checksum and cryptographic authentication tag
curl -sSf -X POST "https://api.ecdat.corp/api/v1/security/database/backups/${BACKUP_ID}/verify" \
  -H "X-API-Key: ${ECDAT_API_KEY}" | jq .
```

### 3. Native PostgreSQL Snapshot (Disaster Recovery)
```bash
# Export encrypted physical database dump
PGPOD=$(kubectl get pod -n ecdat-control-plane -l app.kubernetes.io/component=postgres -o jsonpath="{.items[0].metadata.name}")

kubectl exec -n ecdat-control-plane "${PGPOD}" -- \
  pg_dump -U ecdat_app -d ecdat_prod --format=custom --no-owner --no-privileges \
  | openssl enc -aes-256-gcm -salt -pbkdf2 -out ecdat_prod_backup_$(date +%Y%m%d_%H%M%S).dump.enc -pass env:DATA_ENCRYPTION_KEY
```

### 4. Restoration Procedure
```bash
# Step 1: Stop backend traffic to prevent writes during restoration
kubectl scale deployment ecdat-backend --replicas=0 -n ecdat-control-plane

# Step 2: Decrypt and restore PostgreSQL custom dump
openssl enc -d -aes-256-gcm -pbkdf2 -in ecdat_prod_backup_*.dump.enc -pass env:DATA_ENCRYPTION_KEY \
  | kubectl exec -i -n ecdat-control-plane "${PGPOD}" -- pg_restore -U ecdat_app -d ecdat_prod --clean --if-exists

# Step 3: Re-enable backend pods and verify health
kubectl scale deployment ecdat-backend --replicas=3 -n ecdat-control-plane
kubectl rollout status deployment ecdat-backend -n ecdat-control-plane
curl -sSf https://api.ecdat.corp/health | jq .
```

---

## RB-04: Security Incident Response

### 1. Severity Levels & SLA
- **P1 (Critical)**: Active credential leak, unauthorized access to encrypted data, or eBPF breakout. SLA: **Immediate (< 15 mins)**.
- **P2 (High)**: Bypass of policy evaluation gate, tampering with audit logs. SLA: **1 hour**.
- **P3 (Medium)**: Denial of service on scanner pipeline, abnormal rate-limit trip. SLA: **4 hours**.

### 2. Triage & Forensic Evidence Collection
```bash
# Collect immutable cryptographic audit ledger
curl -sSf -X GET "https://api.ecdat.corp/api/v1/audit/export?format=json" \
  -H "X-API-Key: ${ECDAT_API_KEY}" > forensic_audit_ledger_$(date +%Y%m%d).json

# Verify audit ledger cryptographic integrity
curl -sSf -X GET "https://api.ecdat.corp/api/v1/audit/verify" \
  -H "X-API-Key: ${ECDAT_API_KEY}" | jq .

# Capture container logs across all pods
kubectl logs -n ecdat-control-plane -l app.kubernetes.io/name=ecdat --tail=5000 > control_plane_incident.log
kubectl logs -n ecdat-runtime -l app.kubernetes.io/name=ecdat-ebpf-agent --tail=5000 > runtime_agent_incident.log
```

### 3. Containment
- Invalidate all user sessions: execute [RB-06](#rb-06-compromised-credential-protocol).
- Restrict network ingress to bastion IPs via `NetworkPolicy`.
- Disconnect suspected pods using `kubectl label pod <pod-name> quarantine=true`.

---

## RB-05: Discovery Scanner Failure

### 1. Symptoms & Exit Codes
- CI/CD pipeline fails with unexpected non-zero exit code:
  - **Exit Code 0**: Scan successful, zero policy blockers.
  - **Exit Code 1**: Policy failure (findings exceed threshold; intentional block).
  - **Exit Code 2**: Syntax or argument failure.
  - **Exit Code 3**: Scanner runtime crash / uncaught exception.

### 2. Diagnostic Steps
```bash
# Step 1: Inspect scan errors API endpoint
SCAN_ID="<FAILED_SCAN_ID>"
curl -sSf "https://api.ecdat.corp/api/v1/scans/${SCAN_ID}/errors" \
  -H "X-API-Key: ${ECDAT_API_KEY}" | jq .

# Step 2: Check for Zip Bomb / Archive size limit tripping
# Look for error: "Decompression ratio exceeds maximum allowed ceiling (100:1)"
kubectl logs -n ecdat-control-plane -l app.kubernetes.io/component=scanner --tail=200 | grep -i "zip bomb"

# Step 3: Check memory limits (OOMKill)
kubectl describe pod -n ecdat-control-plane -l app.kubernetes.io/component=scanner | grep -i "oomkilled"
```

### 3. Resolution
- If an AST parser crashes on complex code: ensure regex fallback is active via `--allow-regex-fallback`.
- If memory limit is reached on massive repos: increase pod resource ceiling in `deploy/k8s/01-resource-quotas.yaml` or pass `--max-memory-mb 2048`.

---

## RB-06: Compromised Credential Protocol

### 1. Trigger
An API key, JWT secret, database credential, or encryption key is suspected of being exposed.

### 2. Immediate Containment Procedure (Execute in Order)

#### Step 1: Invalidate All Active Sessions
```bash
curl -sSf -X POST "https://api.ecdat.corp/api/v1/auth/logout-all" \
  -H "X-API-Key: ${ECDAT_API_KEY}" \
  -H "Content-Type: application/json" | jq .
```

#### Step 2: Revoke Compromised Tokens
```bash
curl -sSf -X POST "https://api.ecdat.corp/api/v1/auth/token/revoke" \
  -H "X-API-Key: ${ECDAT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"token":"<SUSPECTED_TOKEN_OR_REFRESH_TOKEN>"}' | jq .
```

#### Step 3: Rotate JWT Signing Key
```bash
curl -sSf -X POST "https://api.ecdat.corp/api/v1/auth/secrets/rotate" \
  -H "X-API-Key: ${ECDAT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"secretType":"jwt_signing_key","reason":"Compromised credential incident"}' | jq .
```

#### Step 4: Rotate Master API Key in Kubernetes
```bash
NEW_API_KEY=$(openssl rand -hex 32)

kubectl patch secret ecdat-production-secrets -n ecdat-control-plane \
  --type='json' -p="[{\"op\": \"replace\", \"path\": \"/data/ECDAT_API_KEY\", \"value\":\"$(echo -n "${NEW_API_KEY}" | base64)\"}]"

# Trigger rolling restart of backend pods
kubectl rollout restart deployment/ecdat-backend -n ecdat-control-plane
```

---

## RB-07: eBPF Runtime Subsystem Failure

### 1. Symptoms & Diagnostic Alerts
- Metric `ecdat_ebpf_events_dropped_total` increasing rapidly.
- Log error: `KernelCompatibilityError: Host kernel version < 5.8 or BPF filesystem missing`.
- Watchdog alert: `RuntimeSecurityAgent watchdog timed out after 5s`.

### 2. Kernel Diagnostic Commands
```bash
# Check host Linux kernel version on node
uname -r  # Must be >= 5.8

# Verify BPF filesystem is mounted
mount | grep -i bpf

# Check agent logs
kubectl logs -n ecdat-runtime daemonset/ecdat-ebpf-agent --tail=200
```

### 3. Resolution & Isolation
The architecture guarantees that an eBPF failure **never halts the control plane**.
```bash
# Step 1: If ringbuffer drops occur under high traffic, increase ringbuffer allocation (max 64MB)
kubectl set env daemonset/ecdat-ebpf-agent -n ecdat-runtime ECDAT_EBPF_RINGBUF_SIZE_MB=32

# Step 2: If a specific node has incompatible kernel hooks, gracefully stop the agent
kubectl scale daemonset ecdat-ebpf-agent -n ecdat-runtime --replicas=0

# Step 3: Verify control plane continues functioning normally
curl -sSf https://api.ecdat.corp/health | jq .
```

---

## RB-08: Database Outage and Recovery

### 1. Symptoms
- Backend `/health` reports `status: "degraded"`.
- Backend logs show `KnexTimeoutError` or `Connection terminated unexpectedly`.

### 2. Step-by-Step Triage
```bash
# Step 1: Inspect PostgreSQL pod status and logs
kubectl get pods -n ecdat-control-plane -l app.kubernetes.io/component=postgres
kubectl logs -n ecdat-control-plane -l app.kubernetes.io/component=postgres --tail=100

# Step 2: Check disk utilization on PVC
kubectl exec -n ecdat-control-plane statefulset/ecdat-postgres -- df -h /var/lib/postgresql/data

# Step 3: Check active database connection count
kubectl exec -n ecdat-control-plane statefulset/ecdat-postgres -- \
  psql -U ecdat_app -d ecdat_prod -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"
```

### 3. Recovery Actions
- **Pool Exhaustion**: If connections $\ge$ 100, terminate idle sessions:
  ```sql
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND state_change < now() - interval '5 minutes';
  ```
- **Disk Full**: Expand the PVC in `deploy/k8s/05-postgres-statefulset.yaml` or run prune API:
  ```bash
  curl -sSf -X POST "https://api.ecdat.corp/api/v1/security/database/prune" \
    -H "X-API-Key: ${ECDAT_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"olderThanDays":90}' | jq .
  ```

---

## RB-09: Certificate & PKI Anomalies

### 1. Symptoms
- API clients report `CERT_HAS_EXPIRED` or `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
- Startup failure: `ProductionRequiresDatabaseTlsError: DATABASE_SSL_REJECT_UNAUTHORIZED must be true`.

### 2. Diagnosis
```bash
# Check certificate anomalies reported by ECDAT
curl -sSf "https://api.ecdat.corp/api/v1/certificates/anomalies" \
  -H "X-API-Key: ${ECDAT_API_KEY}" | jq .

# Verify Ingress TLS expiration
echo | openssl s_client -servername api.ecdat.corp -connect api.ecdat.corp:443 2>/dev/null | openssl x509 -noout -dates
```

### 3. Resolution
- Trigger immediate renewal via Cert-Manager:
  ```bash
  kubectl renew cert ecdat-ingress-cert -n ecdat-control-plane
  ```
- If PostgreSQL internal TLS certificate expired: regenerate CA/certs in `deploy/k8s/04-secrets.yaml` and restart Postgres StatefulSet.

---

## RB-10: External Integration Outages (SIEM / KMS / Ticketing)

### 1. Symptoms
- SIEM dispatcher logs: `HTTP 503 from Splunk HEC` or `Elasticsearch connection refused`.
- Ticketing webhook error: `Jira API rate limit exceeded (HTTP 429)`.

### 2. Action: SIEM Dispatcher Queue Management
```bash
# Step 1: Inspect SIEM integration status
curl -sSf "https://api.ecdat.corp/api/v1/siem/config" \
  -H "X-API-Key: ${ECDAT_API_KEY}" | jq .

# Step 2: Temporarily divert SIEM target to local Syslog or internal file buffer
curl -sSf -X PUT "https://api.ecdat.corp/api/v1/siem/config" \
  -H "X-API-Key: ${ECDAT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"targets":[{"type":"syslog","host":"internal-syslog.local","port":514}]}' | jq .
```

---

## RB-11: Emergency Rollback Procedure

### 1. Trigger
A newly deployed release causes critical service failure, data corruption, or severe performance degradation.

### 2. Step-by-Step Rollback Execution

#### Step 1: Rollback Helm Release
```bash
# Check Helm revision history
helm history ecdat -n ecdat-control-plane

# Roll back to previous revision (e.g. revision 1)
helm rollback ecdat 1 -n ecdat-control-plane --wait --timeout 5m
```

#### Step 2: Rollback Database Schema (If Necessary)
```bash
# Run one-shot migration rollback job
kubectl run ecdat-migration-rollback \
  --namespace ecdat-control-plane \
  --image=ecdat-backend:v1.0.0 \
  --restart=Never \
  --rm -i -- npm run migrate:rollback
```

#### Step 3: Verify Health
```bash
curl -sSf https://api.ecdat.corp/health | jq .
```
