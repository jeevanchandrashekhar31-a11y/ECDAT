import json
import os
import pytest

def test_cloud_tls_policies_values_transcribed():
    rules_dir = os.path.join(os.path.dirname(__file__), "..", "..", "rules")
    filepath = os.path.join(rules_dir, "cloud_tls_policies.json")
    
    assert os.path.exists(filepath), f"{filepath} does not exist"
    
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
        
    policies = data["policies"]
    
    # Check AWS ELB policies
    assert policies["ELBSecurityPolicy-2016-08"]["min_protocol"] == "TLSv1.0"
    assert "AES128-GCM-SHA256" in policies["ELBSecurityPolicy-2016-08"]["ciphers"]
    
    assert policies["ELBSecurityPolicy-TLS13-1-2-2021-06"]["min_protocol"] == "TLSv1.2"
    assert "TLS_AES_128_GCM_SHA256" in policies["ELBSecurityPolicy-TLS13-1-2-2021-06"]["ciphers"]
    
    assert policies["ELBSecurityPolicy-TLS-1-2-2017-01"]["min_protocol"] == "TLSv1.2"
    
    # Check Azure policies
    assert policies["AppGwSslPolicy20150501"]["min_protocol"] == "TLSv1.0"
    assert policies["AppGwSslPolicy20170401S"]["min_protocol"] == "TLSv1.2"
    assert policies["AppGwSslPolicy20220101"]["min_protocol"] == "TLSv1.2"
    
    # Check GCP policies
    assert policies["GCP-COMPATIBLE"]["min_protocol"] == "TLSv1.0"
    assert policies["GCP-MODERN"]["min_protocol"] == "TLSv1.2"
    assert policies["GCP-RESTRICTED"]["min_protocol"] == "TLSv1.2"

    for name, policy in policies.items():
        assert "min_protocol" in policy
        assert "ciphers" in policy
        assert "pqc_hybrid_support" in policy
        assert "source_url" in policy, f"Policy {name} is missing a source_url citation"
        assert policy["source_url"].strip() != "", f"Policy {name} has an empty source_url citation"
        assert "verified_date" in policy, f"Policy {name} is missing a verified_date"
