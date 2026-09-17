"""
Unit and Integration Tests for Phase 6.1: Runtime & eBPF Discovery Subsystem

Validates:
1. Process -> Library/Function -> Crypto Operation -> Parameters -> Application/Service -> Crypto Asset chain.
2. Metadata-only invariant: Strict rejection of private keys, plaintext, passwords, tokens, and raw payloads.
3. Graceful degradation: Seamless disablement when kernel eBPF capabilities, root privileges, or Linux OS are unavailable.
4. Uprobe and probe catalog resolution for OpenSSL, BoringSSL, LibreSSL, mbedTLS, and wolfSSL.
5. CBOM transformation into CycloneDX 1.6 with RUNTIME_CONFIRMED reachability.
"""

import pytest
from scanners.runtime.engine import (
    KernelCapabilityChecker,
    RuntimeCapabilityStatus,
    RuntimeCryptoEvent,
    RuntimeObservationSubsystem,
    RuntimeProbesCatalog,
    SensitiveDataExposureError,
    assert_metadata_only,
)
from scanners.cbom_mapping import runtime_event_to_cbom, serialize_cbom, validate_cbom_json


class TestGracefulDegradation:
    """Validates graceful degradation when kernel eBPF capabilities are unavailable."""

    def test_disabled_by_config(self):
        checker = KernelCapabilityChecker()
        status, reason = checker.check_capabilities(enabled_in_config=False)
        assert status == RuntimeCapabilityStatus.DISABLED_BY_CONFIG
        assert "disabled by configuration" in reason.lower()

        subsystem = RuntimeObservationSubsystem(enabled=False)
        assert subsystem.is_operational() is False
        assert subsystem.status == RuntimeCapabilityStatus.DISABLED_BY_CONFIG

    def test_graceful_non_linux_or_privilege_handling(self, monkeypatch):
        # Emulate non-linux platform
        monkeypatch.setattr("platform.system", lambda: "Windows")
        status, reason = KernelCapabilityChecker.check_capabilities(enabled_in_config=True)
        assert status == RuntimeCapabilityStatus.UNAVAILABLE_NON_LINUX
        assert "requires linux" in reason.lower()

        subsystem = RuntimeObservationSubsystem(enabled=True)
        assert subsystem.is_operational() is False

    def test_graceful_non_root_on_linux(self, monkeypatch):
        monkeypatch.setattr("platform.system", lambda: "Linux")
        monkeypatch.setattr("os.geteuid", lambda: 1000, raising=False)  # Non-root UID
        status, reason = KernelCapabilityChecker.check_capabilities(enabled_in_config=True)
        assert status == RuntimeCapabilityStatus.UNAVAILABLE_NO_ROOT_OR_CAP_BPF
        assert "requires root or cap_bpf" in reason.lower()


class TestMetadataOnlyInvariant:
    """Validates strict rejection of sensitive fields, private keys, plaintext, and tokens."""

    def test_clean_metadata_allowed(self):
        valid_params = {
            "cipher_name": "AES-256-GCM",
            "key_length": 256,
            "mode": "GCM",
            "operation": "encrypt_init",
        }
        # Should not raise
        assert_metadata_only(valid_params)

        event = RuntimeCryptoEvent(
            process_id=4092,
            process_name="nginx",
            library_name="OpenSSL",
            function_name="EVP_EncryptInit_ex",
            crypto_operation="symmetric_encryption_init",
            parameters=valid_params,
        )
        assert event.parameters["cipher_name"] == "AES-256-GCM"

    def test_rejection_of_private_key_keyname(self):
        with pytest.raises(SensitiveDataExposureError) as exc_info:
            assert_metadata_only({"private_key": "any_value"})
        assert "Forbidden sensitive field 'private_key'" in str(exc_info.value)

    def test_rejection_of_plaintext_keyname(self):
        with pytest.raises(SensitiveDataExposureError) as exc_info:
            assert_metadata_only({"plaintext": "hello secret world"})
        assert "Forbidden sensitive field 'plaintext'" in str(exc_info.value)

    def test_rejection_of_password_and_token(self):
        with pytest.raises(SensitiveDataExposureError):
            assert_metadata_only({"password": "hunter2"})

        with pytest.raises(SensitiveDataExposureError):
            assert_metadata_only({"auth_token": "eyJhbGciOi..."})

    def test_rejection_of_pem_private_key_content(self):
        pem_key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y18V...\n-----END RSA PRIVATE KEY-----"
        with pytest.raises(SensitiveDataExposureError) as exc_info:
            assert_metadata_only({"captured_buffer": pem_key})
        assert "Private key material detected" in str(exc_info.value)

    def test_runtime_crypto_event_enforces_metadata_only_at_init(self):
        with pytest.raises(SensitiveDataExposureError):
            RuntimeCryptoEvent(
                process_id=101,
                process_name="app",
                library_name="OpenSSL",
                function_name="EVP_EncryptInit_ex",
                crypto_operation="symmetric_encryption_init",
                parameters={"raw_key": "secret_key_material"},
            )


class TestRuntimeSubsystemAndCorrelation:
    """Validates full chain correlation from Process to Library to Crypto Asset."""

    def test_probe_catalog_lookup(self):
        catalog = RuntimeProbesCatalog()
        assert catalog.version == "1.0.0"
        probe = catalog.lookup_function("EVP_EncryptInit_ex")
        assert probe is not None
        assert probe["crypto_operation"] == "symmetric_encryption_init"
        assert probe["library_name"] == "OpenSSL"

    def test_record_event_and_correlate_domain_assets(self):
        subsystem = RuntimeObservationSubsystem(enabled=True)
        event = subsystem.record_event(
            process_id=5812,
            process_name="payment_gateway",
            library_name="OpenSSL",
            function_name="EVP_EncryptInit_ex",
            parameters={"cipher_name": "AES-256-GCM", "key_length": 256, "mode": "GCM"},
            container_id="docker://c38a19bc",
            application_name="payment-service",
            service_name="checkout",
        )

        assert event.process_id == 5812
        assert event.crypto_operation == "symmetric_encryption_init"

        # Correlate into domain graph
        correlation = subsystem.correlate_to_domain_assets(event)
        assert correlation["application_ref"] == "app:payment-service"
        assert correlation["process_ref"] == "proc:5812:payment_gateway"
        assert correlation["library_ref"] == "lib:openssl"
        assert correlation["function_ref"] == "fn:openssl:EVP_EncryptInit_ex"
        assert correlation["crypto_asset_id"] == "runtime:asset:AES-256-GCM-256"
        assert correlation["reachability"] == "RUNTIME_CONFIRMED"
        assert correlation["evidence_source"] == "runtime"

        # Verify relationship chain
        rel_types = [r["relationship_type"] for r in correlation["relationships"]]
        assert "hosts_process" in rel_types
        assert "depends_on" in rel_types
        assert "uses" in rel_types
        assert "implements" in rel_types


class TestRuntimeCbomMapping:
    """Validates CycloneDX 1.6 CBOM generation from runtime events."""

    def test_runtime_event_cbom_generation(self):
        event = RuntimeCryptoEvent(
            process_id=1420,
            process_name="envoy",
            library_name="BoringSSL",
            function_name="SSL_do_handshake",
            crypto_operation="tls_handshake",
            parameters={"tls_version": "TLSv1.3", "cipher_suite": "TLS_AES_256_GCM_SHA384"},
            container_id="k8s://ingress-pod-1248",
            application_name="ingress-router",
        )

        cbom = runtime_event_to_cbom(event)
        assert cbom is not None

        comp_names = [c.name for c in cbom.components]
        assert "ingress-router" in comp_names
        assert "envoy (PID 1420)" in comp_names
        assert "BoringSSL" in comp_names

        serialized = serialize_cbom(cbom)
        assert validate_cbom_json(serialized) is True
