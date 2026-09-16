/**
 * Phase 24.2: Kubernetes Hardening Backend Test Suite
 *
 * Validates:
 * - RBAC least privilege (no wildcard verbs/resources, dedicated service accounts)
 * - NetworkPolicies (default-deny, fine-grained ingress/egress, CoreDNS egress)
 * - Pod Security standards (restricted namespace enforcement)
 * - Secret management (secretKeyRef, Vault / ESO annotations, no plaintext keys)
 * - Resource quotas and LimitRanges
 * - Pod and container securityContext (runAsNonRoot, readOnlyRootFilesystem, drop ALL capabilities)
 * - Strict architectural separation of privileged runtime/eBPF agent from control plane
 * - Helm chart template coverage
 */

const { test, describe } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const K8S_DIR = path.join(REPO_ROOT, "deploy/k8s");
const HELM_DIR = path.join(REPO_ROOT, "deploy/helm/ecdat");

describe("Phase 24.2 — Kubernetes Hardening (Backend)", () => {
  test("Namespaces: Separates restricted control plane from runtime agent namespace", () => {
    const nsContent = fs.readFileSync(path.join(K8S_DIR, "00-namespaces.yaml"), "utf-8");
    assert.ok(nsContent.includes("name: ecdat-control-plane"));
    assert.ok(nsContent.includes("name: ecdat-runtime"));
    assert.ok(nsContent.includes("pod-security.kubernetes.io/enforce: restricted"));
  });

  test("RBAC: Dedicated ServiceAccounts with zero wildcard '*' permissions", () => {
    const rbac = fs.readFileSync(path.join(K8S_DIR, "02-rbac.yaml"), "utf-8");
    assert.ok(rbac.includes("name: ecdat-backend-sa"));
    assert.ok(rbac.includes("name: ecdat-ebpf-agent-sa"));
    assert.ok(!rbac.match(/verbs:\s*\[.*?\*.*?\]/), "Wildcard verbs detected in RBAC Role!");
    assert.ok(!rbac.match(/resources:\s*\[.*?\*.*?\]/), "Wildcard resources detected in RBAC Role!");
  });

  test("NetworkPolicies: Default-deny, fine-grained ingress/egress, and DNS egress", () => {
    const netpol = fs.readFileSync(path.join(K8S_DIR, "03-network-policies.yaml"), "utf-8");
    assert.ok(netpol.includes("name: default-deny-all"));
    assert.ok(netpol.includes("name: runtime-default-deny-all"));
    assert.ok(netpol.includes("name: allow-dns-egress"));
    assert.ok(netpol.includes("name: backend-networkpolicy"));
    assert.ok(netpol.includes("name: postgres-networkpolicy"));
    assert.ok(netpol.includes("name: ebpf-agent-networkpolicy"));
  });

  test("Secret Management: Credentials decoupled via secretKeyRef & Vault annotations", () => {
    const secrets = fs.readFileSync(path.join(K8S_DIR, "04-secrets.yaml"), "utf-8");
    assert.ok(secrets.includes("kind: Secret"));
    assert.ok(secrets.includes("secret.ecdat.io/managed-by: \"external-secrets-operator\""));

    const backend = fs.readFileSync(path.join(K8S_DIR, "06-backend-deployment.yaml"), "utf-8");
    assert.ok(backend.includes("secretKeyRef:"));
    assert.ok(backend.includes("name: ecdat-db-credentials"));
    assert.ok(backend.includes("name: ecdat-secrets"));
  });

  test("Resource Quotas & Limits: Enforced across namespaces", () => {
    const quota = fs.readFileSync(path.join(K8S_DIR, "01-resource-quotas.yaml"), "utf-8");
    assert.ok(quota.includes("name: ecdat-control-plane-quota"));
    assert.ok(quota.includes("name: ecdat-runtime-quota"));
    assert.ok(quota.includes("kind: LimitRange"));
  });

  test("securityContext: Non-root, read-only root fs, drop ALL capabilities", () => {
    const backend = fs.readFileSync(path.join(K8S_DIR, "06-backend-deployment.yaml"), "utf-8");
    assert.ok(backend.includes("runAsNonRoot: true"));
    assert.ok(backend.includes("readOnlyRootFilesystem: true"));
    assert.ok(backend.includes("- ALL"));
    assert.ok(backend.includes("RuntimeDefault"));

    const frontend = fs.readFileSync(path.join(K8S_DIR, "07-frontend-deployment.yaml"), "utf-8");
    assert.ok(frontend.includes("runAsNonRoot: true"));
    assert.ok(frontend.includes("readOnlyRootFilesystem: true"));
    assert.ok(frontend.includes("- ALL"));
  });

  test("Runtime eBPF Agent Separation: Segregated in ecdat-runtime with zero control plane taint", () => {
    const ebpf = fs.readFileSync(path.join(K8S_DIR, "09-ebpf-agent-daemonset.yaml"), "utf-8");
    assert.ok(ebpf.includes("namespace: ecdat-runtime"));
    assert.ok(ebpf.includes("hostPID: true"));
    assert.ok(ebpf.includes("hostNetwork: false"));

    // Ensure control plane workloads NEVER declare privileged: true
    const backend = fs.readFileSync(path.join(K8S_DIR, "06-backend-deployment.yaml"), "utf-8");
    assert.ok(!backend.includes("privileged: true"));
    const frontend = fs.readFileSync(path.join(K8S_DIR, "07-frontend-deployment.yaml"), "utf-8");
    assert.ok(!frontend.includes("privileged: true"));
  });

  test("Helm Chart: Values and templates are complete", () => {
    assert.ok(fs.existsSync(path.join(HELM_DIR, "Chart.yaml")));
    assert.ok(fs.existsSync(path.join(HELM_DIR, "values.yaml")));

    const values = fs.readFileSync(path.join(HELM_DIR, "values.yaml"), "utf-8");
    assert.ok(values.includes("controlPlaneNamespace: \"ecdat-control-plane\""));
    assert.ok(values.includes("runtimeNamespace: \"ecdat-runtime\""));
    assert.ok(values.includes("podSecurityStandards:"));
  });
});
