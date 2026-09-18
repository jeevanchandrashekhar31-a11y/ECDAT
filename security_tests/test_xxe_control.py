# @ecdat-synthetic-corpus
"""
Adversarial Security Test: XML / XXE Parser Security Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

from pathlib import Path
import xml.etree.ElementTree as ET
import pytest

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "xxe_payloads.xml"


def safe_parse_xml(raw_xml: str) -> ET.Element:
    """
    Enterprise safe XML parser enforcing zero DTD and zero external entity declarations.
    """
    if not isinstance(raw_xml, str):
        raise TypeError("XML content must be a string")

    clean = raw_xml.strip()
    if not clean:
        raise ValueError("XML content cannot be empty")

    upper = clean.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper or "<!ELEMENT" in upper:
        raise ValueError("XXE Security Violation: DTD and external entity declarations are strictly prohibited.")

    return ET.fromstring(clean)


class TestXXEControl:
    """
    Security Control: XML Parser Security & External Entity (XXE) Defense
    Guarantees that DOCTYPE external entities and recursive expansion attacks (billion laughs) are blocked.
    """

    # 1. POSITIVE TEST: Well-formed benign XML parses successfully
    def test_positive_xxe(self):
        valid_xml = '<cbom version="1.6"><cryptoAsset name="AES-256-GCM" keyLength="256" /></cbom>'
        root = safe_parse_xml(valid_xml)
        assert root.tag == "cbom"
        assert root.attrib["version"] == "1.6"

    # 2. NEGATIVE TEST: Malformed XML fails cleanly with syntax error
    def test_negative_xxe(self):
        malformed = "<cbom><unclosed_tag>"
        with pytest.raises(ET.ParseError):
            safe_parse_xml(malformed)

        with pytest.raises(ValueError):
            safe_parse_xml("")

    # 3. BOUNDARY TEST: Deeply nested benign tags without entities
    def test_boundary_xxe(self):
        depth = 30
        nested = "<root>" + "<level>" * depth + "data" + "</level>" * depth + "</root>"
        root = safe_parse_xml(nested)
        assert root.tag == "root"

    # 4. MALICIOUS TEST: Intentionally malicious XXE fixtures blocked
    def test_malicious_xxe(self):
        # 1. External file disclosure attempt
        file_read_payload = """<?xml version="1.0"?>
<!DOCTYPE test [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<data>&xxe;</data>"""
        with pytest.raises(ValueError) as exc_info:
            safe_parse_xml(file_read_payload)
        assert "XXE Security Violation" in str(exc_info.value)

        # 2. SSRF metadata extraction attempt via XXE
        ssrf_payload = """<?xml version="1.0"?>
<!DOCTYPE test [
  <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
]>
<data>&xxe;</data>"""
        with pytest.raises(ValueError) as exc_info:
            safe_parse_xml(ssrf_payload)
        assert "XXE Security Violation" in str(exc_info.value)

        # 3. Recursive entity expansion (Billion Laughs denial-of-service bomb)
        billion_laughs = """<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
]>
<data>&lol2;</data>"""
        with pytest.raises(ValueError) as exc_info:
            safe_parse_xml(billion_laughs)
        assert "XXE Security Violation" in str(exc_info.value)

    # 5. REGRESSION TEST: DTD entities cannot bypass case-folding pre-flight filters
    def test_regression_xxe(self):
        mixed_case = """<?xml version="1.0"?>
<!dOcTyPe test [
  <!EnTiTy xxe "secret">
]>
<root>&xxe;</root>"""
        with pytest.raises(ValueError):
            safe_parse_xml(mixed_case)
