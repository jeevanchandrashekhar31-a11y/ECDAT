# ECDAT Pre-Cleanup Repository Inventory

## 1. Executive Summary
- **Total files evaluated**: 24886
- **Action breakdown**:
  - **KEEP**: 24886
- **Classification breakdown**:
  - **configuration**: 260
  - **documentation**: 223
  - **example**: 3726
  - **fixture**: 51
  - **generated**: 19734
  - **release_artifact**: 3
  - **source**: 360
  - **test**: 415
  - **unknown**: 114

## 2. Action Table for Primary Candidates

| Path | Type | Size (Bytes) | Tracked | Classification | References | Action | Reason | Confidence |
|---|---|---|---|---|---|---|---|---|
| `.dockerignore` | `no_extension` | 137 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `.gitignore` | `no_extension` | 365 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `.gitmodules` | `no_extension` | 314 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `docker-compose.yml` | `.yml` | 5099 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `package-lock.json` | `.json` | 193 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `package.json` | `.json` | 906 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `pyproject.toml` | `.toml` | 217 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `pytest.ini` | `.ini` | 42 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `README.md` | `.md` | 2888 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `requirements-lock.txt` | `.txt` | 1203 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `requirements.lock` | `.lock` | 1386 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `requirements.txt` | `.txt` | 396 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `SECURITY.md` | `.md` | 970 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `SUPPLY_CHAIN_SECURITY.md` | `.md` | 10545 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `.github/dependabot.yml` | `.yml` | 1251 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `artifacts/SHA256SUMS` | `no_extension` | 554 | True | release_artifact | None | **KEEP** | Tracked release integrity artifact / benchmark / SBOM - Section 11 compliance | HIGH |
| `artifacts/SHA256SUMS.sig` | `.sig` | 64 | True | release_artifact | None | **KEEP** | Tracked release integrity artifact / benchmark / SBOM - Section 11 compliance | HIGH |
| `artifacts/SHA512SUMS` | `no_extension` | 874 | True | release_artifact | None | **KEEP** | Tracked release integrity artifact / benchmark / SBOM - Section 11 compliance | HIGH |
| `backend/.env` | `no_extension` | 649 | False | unknown | None | **KEEP** | Active repository component | HIGH |
| `backend/.env.example` | `.example` | 807 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `backend/Dockerfile` | `no_extension` | 1142 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `backend/eslint.config.js` | `.js` | 754 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `backend/knexfile.js` | `.js` | 1603 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `backend/package-lock.json` | `.json` | 107666 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `backend/package.json` | `.json` | 1012 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `backend/README.md` | `.md` | 3164 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docker/.env.example` | `.example` | 252 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `docker/backend-entrypoint.sh` | `.sh` | 79 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `docker/demo_cbom.json` | `.json` | 4335 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `docker/demo_import.py` | `.py` | 2422 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `docker/scanner.Dockerfile` | `.dockerfile` | 1163 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `docs/ADVERSARIAL_SCANNER_ASSESSMENT.md` | `.md` | 12159 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/API_DOCUMENTATION.md` | `.md` | 24121 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/ARCHITECTURE.md` | `.md` | 28658 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/ARCHITECTURE_GAP.md` | `.md` | 4906 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/AUTH_ROADMAP.md` | `.md` | 4910 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/BINARY_CONTAINER_SCANNER.md` | `.md` | 8983 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/CANONICAL_CRYPTO_MODEL.md` | `.md` | 5411 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/CERTIFICATE_INTELLIGENCE.md` | `.md` | 5207 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/CI_CD.md` | `.md` | 1574 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/CONTAINER_HARDENING.md` | `.md` | 7037 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/CORRELATION_ENGINE.md` | `.md` | 7566 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/DATABASE_SECURITY.md` | `.md` | 10047 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/DATA_PROTECTION.md` | `.md` | 12727 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/DEPLOYMENT.md` | `.md` | 2929 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/ECDAT_CBOM_SCHEMA_CONTRACT.md` | `.md` | 6710 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/EVIDENCE_INTEGRITY.md` | `.md` | 9024 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/EXECUTIVE_REPORTING.md` | `.md` | 7531 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/FEATURE_PARITY_AUDIT.md` | `.md` | 29960 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/FILESYSTEM_SCANNER.md` | `.md` | 5050 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/FINAL_QUALITY_GATE.md` | `.md` | 7277 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/IDENTITY_RULES.md` | `.md` | 3253 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/KUBERNETES_HARDENING.md` | `.md` | 8586 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/NETWORK_SCANNER.md` | `.md` | 4045 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/OPERATOR_RUNBOOKS.md` | `.md` | 15842 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/PHASE1_CBOM_CORE.md` | `.md` | 2079 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/PHASE1_SETUP.md` | `.md` | 736 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/PQC_HYBRID_ANALYSIS.md` | `.md` | 4595 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/PRODUCTION_CONFIGURATION.md` | `.md` | 6455 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/REPO_INVENTORY.md` | `.md` | 6351 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/RISK_REGISTER.md` | `.md` | 5912 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/RUNTIME_DISCOVERY.md` | `.md` | 7162 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/SECURITY_ASSESSMENT_PHASE_23_1.md` | `.md` | 15913 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/SECURITY_REGRESSION_POLICY.md` | `.md` | 6924 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/SECURITY_REVIEW.md` | `.md` | 3901 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/STATIC_SCANNER.md` | `.md` | 2260 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/TARGET_STRUCTURE.md` | `.md` | 4035 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/TECHNICAL_REPORTING.md` | `.md` | 15624 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/TESTING.md` | `.md` | 2115 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/THREAT_MODEL.md` | `.md` | 3220 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `docs/VULNERABILITY_RELEASE_GATE.md` | `.md` | 7334 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `examples/FINAL_CBOM_SAMPLE.json` | `.json` | 7709 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `examples/FINAL_SBOM_SAMPLE.json` | `.json` | 7662 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/.dockerignore` | `no_extension` | 30 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/.env.example` | `.example` | 215 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/.prettierrc.json` | `.json` | 89 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/Dockerfile` | `no_extension` | 1149 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/eslint.config.js` | `.js` | 312 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/index.html` | `.html` | 1567 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/nginx.conf` | `.conf` | 2087 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/package-lock.json` | `.json` | 196037 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/package.json` | `.json` | 1198 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/postcss.config.js` | `.js` | 80 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/README.md` | `.md` | 3676 | True | documentation | None | **KEEP** | Active repository component | HIGH |
| `frontend/sbom-test.json` | `.json` | 0 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/tailwind.config.js` | `.js` | 842 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/tsconfig.json` | `.json` | 552 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/tsconfig.node.json` | `.json` | 213 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `frontend/vite.config.ts` | `.ts` | 2178 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `frontend/vitest.config.ts` | `.ts` | 286 | True | unknown | None | **KEEP** | Active repository component | HIGH |
| `rules/adversarial_scanner_catalog.json` | `.json` | 30986 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/algorithm_risk.json` | `.json` | 18486 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/compliance_catalog.json` | `.json` | 18278 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/crypto_agility_rules.json` | `.json` | 16363 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/crypto_dependency_mapping.json` | `.json` | 13781 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/crypto_library_catalog.json` | `.json` | 5037 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/crypto_library_fingerprints.json` | `.json` | 20301 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/crypto_vulnerability_catalog.json` | `.json` | 6407 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/identity_rules.json` | `.json` | 1063 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/mosca_config.json` | `.json` | 4308 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/policy_as_code.json` | `.json` | 8517 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/policy_profiles.json` | `.json` | 6604 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/pqc_algorithm_catalog.json` | `.json` | 53349 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/pqc_recommendations.json` | `.json` | 13173 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/runtime_probes_catalog.json` | `.json` | 3852 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/security_exceptions.json` | `.json` | 1309 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/security_regressions.json` | `.json` | 20135 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/severity_overrides.json` | `.json` | 844 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/vulnerability_release_policy.json` | `.json` | 1704 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `rules/vulnerability_risk_acceptance.json` | `.json` | 1303 | True | configuration | None | **KEEP** | Active repository component | HIGH |
| `scanners/api_security.py` | `.py` | 9443 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/approval_workflow.py` | `.py` | 19763 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/cbom_diff.py` | `.py` | 8670 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/cbom_io.py` | `.py` | 16875 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/cbom_mapping.py` | `.py` | 32375 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/ci_scanner.py` | `.py` | 39362 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/compliance_mapping.py` | `.py` | 17523 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/config.py` | `.py` | 3337 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/container_hardening_auditor.py` | `.py` | 18143 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/crypto_agility.py` | `.py` | 31119 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/developer_feedback.py` | `.py` | 28895 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/gating.py` | `.py` | 1968 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/k8s_hardening_auditor.py` | `.py` | 14202 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/migration_planner.py` | `.py` | 21701 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/models.py` | `.py` | 5760 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/patch_generator.py` | `.py` | 24005 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/policy_engine.py` | `.py` | 31042 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/policy_security.py` | `.py` | 21241 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/pqc_knowledge_base.py` | `.py` | 5764 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/production_config_guard.py` | `.py` | 7461 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/regression_policy.py` | `.py` | 10650 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/remediation_planner.py` | `.py` | 37063 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/sarif_engine.py` | `.py` | 16618 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scanners/vulnerability_release_gate.py` | `.py` | 26993 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/audit_typing_imports.py` | `.py` | 6024 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/clean_leaked_paths.py` | `.py` | 1795 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/final_quality_gate.py` | `.py` | 25576 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/generate_pre_cleanup_inventory.py` | `.py` | 12915 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/generate_provenance.py` | `.py` | 6310 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/generate_sbom.py` | `.py` | 18593 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/release_gate.py` | `.py` | 22572 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/scan_vulnerabilities.py` | `.py` | 18326 | True | source | None | **KEEP** | Active repository component | HIGH |
| `scripts/sign_artifacts.py` | `.py` | 9086 | True | source | None | **KEEP** | Active repository component | HIGH |
| `security_audit/pre_cleanup_inventory.json` | `.json` | 8390482 | False | configuration | None | **KEEP** | Active repository component | HIGH |
| `security_audit/pre_cleanup_inventory.md` | `.md` | 116600 | False | documentation | None | **KEEP** | Active repository component | HIGH |
| `tests/test_adversarial_scanner.py` | `.py` | 6790 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_api_security.py` | `.py` | 8049 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_approval_workflow.py` | `.py` | 6270 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_archive_safety.py` | `.py` | 5614 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_authentication_hardening.py` | `.py` | 9512 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_binary_parser.py` | `.py` | 16990 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_cbom_17_compliance.py` | `.py` | 11736 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_cbom_deep_lifecycle.py` | `.py` | 15044 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_cbom_io_and_diff.py` | `.py` | 10201 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_ci_scanner.py` | `.py` | 11279 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_compliance_mapping.py` | `.py` | 6437 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_config.py` | `.py` | 1514 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_container_hardening.py` | `.py` | 5231 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_crypto_agility.py` | `.py` | 6057 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_crypto_dependency_mapping.py` | `.py` | 6026 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_csharp_rust_crypto_rules.py` | `.py` | 6020 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_c_cpp_crypto_rules.py` | `.py` | 6526 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_developer_feedback.py` | `.py` | 7372 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_evidence_integrity.py` | `.py` | 7999 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_executive_reporting.py` | `.py` | 6938 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_failure_isolation.py` | `.py` | 4770 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_filesystem_scanner.py` | `.py` | 11957 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_final_quality_gate.py` | `.py` | 3583 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_fuzz_parsers.py` | `.py` | 23202 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_golden_corpus.py` | `.py` | 7391 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_go_crypto_rules.py` | `.py` | 5684 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_identity_integration.py` | `.py` | 4377 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_interprocedural_analysis.py` | `.py` | 14880 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_java_kotlin_crypto_rules.py` | `.py` | 5231 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_js_ts_crypto_rules.py` | `.py` | 5016 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_k8s_hardening.py` | `.py` | 5356 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_kms_connectors.py` | `.py` | 16458 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_large_repo_scaling.py` | `.py` | 6317 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_library_fingerprinting.py` | `.py` | 8935 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_migration_planner.py` | `.py` | 7925 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_multi_tenancy_isolation.py` | `.py` | 10969 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_parity_audit.py` | `.py` | 3512 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_parsers_deep_resilience.py` | `.py` | 8600 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_parser_abstraction.py` | `.py` | 5075 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_patch_generator.py` | `.py` | 5395 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_pcap_safety.py` | `.py` | 7203 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_policy_engine.py` | `.py` | 6944 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_policy_security.py` | `.py` | 6519 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_pqc_knowledge_base.py` | `.py` | 3544 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_production_configuration.py` | `.py` | 7124 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_python_crypto_rules.py` | `.py` | 4847 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_rbac_authorization.py` | `.py` | 7857 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_remediation_planner.py` | `.py` | 7028 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_sarif_engine.py` | `.py` | 10449 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_sbom_ingestion.py` | `.py` | 6818 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_secret_safe_crypto.py` | `.py` | 6504 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_security_regressions.py` | `.py` | 18838 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_security_units.py` | `.py` | 3764 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_static_scanner.py` | `.py` | 3303 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_technical_reporting.py` | `.py` | 7625 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_ticketing_connectors.py` | `.py` | 14129 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_vulnerability_correlation.py` | `.py` | 6307 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/test_vulnerability_release_gate.py` | `.py` | 16195 | True | test | None | **KEEP** | Active repository component | HIGH |
| `tests/__init__.py` | `.py` | 19 | True | test | None | **KEEP** | Active repository component | HIGH |

## 3. Protected Test Fixture Corpora (STRICT KEEP)
- `tests/fixtures/hostile_repo/`: Hostile security regression fixtures (path traversal, symlink loops, zip bomb protection).
- `tests/fixtures/large_repos/`: Tracked scale benchmark fixtures (100K, 500K, 1M LOC synthetics).
- `testing/corpora/golden_corpus/`: Golden benchmark detection test cases (11 suites).
- `examples/real_target/`: Embedded target library fixtures (wolfssl, mbedtls).

## 4. Tracked Release Artifacts (STRICT KEEP)
- `artifacts/SHA256SUMS`, `artifacts/SHA256SUMS.sig`, `artifacts/SHA512SUMS`: Release integrity signatures.
- `artifacts/provenance/ecdat_provenance.slsa.json`: SLSA build provenance manifest.
- `artifacts/sbom/*`: CycloneDX and SPDX SBOM release artifacts.
- `artifacts/security/*`: Signed release gate reports and vulnerability audits.
- `artifacts/benchmarks/*`: Benchmark performance baseline records.