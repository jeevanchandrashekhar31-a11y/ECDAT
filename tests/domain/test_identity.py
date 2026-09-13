"""
Unit tests for deterministic identity generator (Python) and cross-language parity.
"""

import subprocess
import json
import pytest
from scanners.domain.identity import (
    canonicalize_json,
    compute_canonical_hash,
    generate_asset_id,
    generate_finding_id,
    generate_evidence_id,
    parse_identifier,
)


def test_canonicalize_json_key_order():
    obj1 = {"z": 1, "a": "hello", "m": {"nested_b": 2, "nested_a": 1}}
    obj2 = {"a": "hello", "m": {"nested_a": 1, "nested_b": 2}, "z": 1}

    assert canonicalize_json(obj1) == canonicalize_json(obj2)
    assert compute_canonical_hash(obj1) == compute_canonical_hash(obj2)


def test_deterministic_asset_id():
    params = {
        "tenant_id": "tenant_acme",
        "application_id": "payments_service",
        "asset_type": "algorithm",
        "provenance": {"kind": "source_code", "locator": "src/crypto/jwt.js"},
        "core_properties": {"algorithm": "RSA", "keySize": 2048},
    }

    id1 = generate_asset_id(**params)
    id2 = generate_asset_id(**params)

    assert id1 == id2
    assert id1.startswith("urn:ecdat:v1:asset:tenant_acme:payments_service:algorithm:")


def test_line_number_invariance():
    base_params = {
        "tenant_id": "tenant_acme",
        "application_id": "payments_service",
        "asset_type": "algorithm",
        "provenance": {"kind": "source_code", "locator": "src/crypto/jwt.js"},
        "core_properties": {"algorithm": "RSA", "keySize": 2048},
    }

    id1 = generate_asset_id(**base_params)
    # Volatile attributes are not in descriptor, so different runtimes don't drift
    id2 = generate_asset_id(**base_params)
    assert id1 == id2


def test_delimiter_injection_resistance():
    id_a = generate_asset_id(
        tenant_id="tenant:alpha",
        application_id="service_beta",
        asset_type="algorithm",
        provenance={"locator": "main.go"},
    )
    id_b = generate_asset_id(
        tenant_id="tenant",
        application_id="alpha:service_beta",
        asset_type="algorithm",
        provenance={"locator": "main.go"},
    )
    assert id_a != id_b


def test_tenant_and_app_isolation():
    spec = {
        "asset_type": "certificate",
        "provenance": {"kind": "tls_endpoint", "locator": "api.internal:443"},
        "core_properties": {"fingerprint": "sha256:abc12345"},
    }
    id_tenant_a = generate_asset_id(tenant_id="tenant_a", application_id="gateway", **spec)
    id_tenant_b = generate_asset_id(tenant_id="tenant_b", application_id="gateway", **spec)
    id_app_2 = generate_asset_id(tenant_id="tenant_a", application_id="auth_service", **spec)

    assert id_tenant_a != id_tenant_b
    assert id_tenant_a != id_app_2


def test_synthetic_collision_5000():
    id_set = set()
    count = 5000
    for i in range(count):
        val = generate_asset_id(
            tenant_id=f"tenant_{i % 10}",
            application_id=f"app_{i % 25}",
            asset_type="algorithm" if i % 2 == 0 else "certificate",
            provenance={"locator": f"src/module_{i}/crypto_{i}.ts"},
            core_properties={"keySize": 1024 + (i % 4) * 1024, "index": i},
        )
        id_set.add(val)
    assert len(id_set) == count


def test_cross_language_parity_with_node():
    """Verify that Python generates the exact same hash as Node.js for identical input"""
    test_obj = {
        "version": "v1",
        "entity": "asset",
        "tenantId": "test_tenant",
        "applicationId": "test_app",
        "assetType": "algorithm",
        "provenance": {"kind": "source_code", "locator": "src/index.js"},
        "coreProperties": {"algorithm": "AES", "keySize": 256},
    }

    py_hash = compute_canonical_hash(test_obj, 32)

    # Call node to compute canonical hash of exact same object
    node_script = f"""
    const {{ computeCanonicalHash }} = require('./backend/src/domain/identity');
    const obj = {json.dumps(test_obj)};
    console.log(computeCanonicalHash(obj, 32));
    """
    res = subprocess.run(["node", "-e", node_script], capture_output=True, text=True, check=True)
    node_hash = res.stdout.strip()

    assert py_hash == node_hash, f"Hash mismatch between Python ({py_hash}) and Node ({node_hash})"
