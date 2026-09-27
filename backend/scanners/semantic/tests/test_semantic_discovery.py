import pytest
import json
import urllib.request
from unittest.mock import patch, MagicMock
from scanners.semantic.semantic_discovery import SemanticDiscoveryEngine

DUMMY_SOURCE_CODE = """
def legitimate_function(a, b):
    print("Just normal code")
    return a + b

def custom_encrypt_data(plaintext, key):
    # A highly suspicious hand-rolled XOR cipher
    ciphertext = []
    for i in range(len(plaintext)):
        char = plaintext[i]
        key_char = key[i % len(key)]
        encrypted_char = chr(ord(char) ^ ord(key_char))
        ciphertext.append(encrypted_char)
    return "".join(ciphertext)
"""

def test_semantic_discovery_pipeline():
    """
    Tests the end-to-end pipeline:
    1. Pre-filter identifies the suspicious `custom_encrypt_data` block.
    2. LLM is called and correctly returns LIKELY_CUSTOM_CRYPTO.
    3. The engine correctly formats the finding with LLM_FLAGGED_UNVERIFIED status.
    """
    
    mock_llm_response = {
        "classification": "LIKELY_CUSTOM_CRYPTO",
        "confidence": 0.95,
        "explanation": "The code snippet contains a custom, hand-rolled XOR encryption loop iterating over plaintext and a key."
    }
    
    mock_response_obj = MagicMock()
    mock_response_obj.read.return_value = json.dumps({
        "choices": [{
            "message": {
                "content": json.dumps(mock_llm_response)
            }
        }]
    }).encode("utf-8")
    
    # We use a mock so the test runs reliably without an actual OpenAI API Key, 
    # proving the pipeline logic (pre-filtering, parsing, formatting).
    with patch("urllib.request.urlopen") as mock_urlopen:
        mock_urlopen.return_value.__enter__.return_value = mock_response_obj
        
        engine = SemanticDiscoveryEngine(api_key="dummy_key_for_test")
        findings = engine.run_scan("dummy_file.py", DUMMY_SOURCE_CODE)
        
        assert len(findings) == 1, "Expected exactly one finding from the pre-filtered block"
        finding = findings[0]
        
        # Verify strict structural requirements mandated in Phase B
        assert finding["detection_method"] == "semantic_llm"
        assert finding["status"] == "LLM_FLAGGED_UNVERIFIED", "MUST NOT be CONFIRMED automatically!"
        assert finding["classification"] == "LIKELY_CUSTOM_CRYPTO"
        assert finding["confidence"] == 0.95
        assert "hand-rolled XOR encryption loop" in finding["explanation"]
        assert "custom_encrypt_data" in finding["snippet"]
