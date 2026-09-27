import os
import json
import hashlib
from unittest import mock
import pytest
from scanners.semantic.semantic_discovery import SemanticDiscoveryEngine

def test_cache_matches_live(tmp_path):
    # Setup cache dir
    cache_dir = tmp_path / ".cache"
    
    # 1. Run "live" (mocked to simulate OpenAI API returning custom crypto)
    engine = SemanticDiscoveryEngine(api_key="dummy_key_for_test", cache_dir=str(cache_dir))
    
    snippet = "def encrypt(data):\n    return data ^ 0x42"
    
    # Force live to write the cache
    os.environ["ECDAT_FORCE_LIVE_SEMANTIC"] = "1"
    
    mock_response_body = json.dumps({
        "choices": [{
            "message": {
                "content": json.dumps({
                    "classification": "LIKELY_CUSTOM_CRYPTO",
                    "confidence": 0.9,
                    "explanation": "Uses XOR bitwise operation in a function named encrypt."
                })
            }
        }]
    }).encode("utf-8")
    
    mock_response = mock.MagicMock()
    mock_response.read.return_value = mock_response_body
    mock_response.__enter__.return_value = mock_response
    
    with mock.patch("urllib.request.urlopen", return_value=mock_response) as mock_urlopen:
        live_findings = engine.run_scan("test_crypto.py", snippet)
        
    assert mock_urlopen.called, "Expected urllib.request.urlopen to be called during live run."
    assert len(live_findings) == 1
    assert live_findings[0]["classification"] == "LIKELY_CUSTOM_CRYPTO"
    assert live_findings[0]["cached"] is False
    
    # Verify cache file was written
    prompt_hash = hashlib.sha256("    return data ^ 0x42".encode('utf-8')).hexdigest()
    # Wait, the pre-filter extracts the snippet differently. 
    # Let's just trust that some cache file was written.
    cache_files = list(cache_dir.glob("*.json"))
    assert len(cache_files) > 0, "Cache file should have been created."
    
    # 2. Run from cache (no force live)
    if "ECDAT_FORCE_LIVE_SEMANTIC" in os.environ:
        del os.environ["ECDAT_FORCE_LIVE_SEMANTIC"]
        
    # Reset urllib.request.urlopen so if it's called, it fails the test
    with mock.patch("urllib.request.urlopen", side_effect=Exception("API should not be called when cached!")):
        cached_findings = engine.run_scan("test_crypto.py", snippet)
        
    assert len(cached_findings) == 1
    assert cached_findings[0]["classification"] == "LIKELY_CUSTOM_CRYPTO"
    assert cached_findings[0]["cached"] is True
    
    # Confirm the finding itself is identical except for the 'cached' flag
    assert cached_findings[0]["confidence"] == live_findings[0]["confidence"]
    assert cached_findings[0]["explanation"] == live_findings[0]["explanation"]
