import pytest
import os
from scanners.static.parsers.crypto_asset_parser import CryptoAssetParser, AssetType

def test_x509_certificate_parsing():
    parser = CryptoAssetParser()
    
    # Example minimal PEM cert (public key)
    pem_cert = """-----BEGIN CERTIFICATE-----
MIIBtzCCAZ0CCQDEy2+K+/4aQDANBgkqhkiG9w0BAQsFADCBjjELMAkGA1UEBhMC
VVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcMDVNhbiBGcmFuY2lzY28x
DzANBgNVBAoMBk15T3JnMRAwDgYDVQQLDAdNeVVuaXQxFTATBgNVBAMMDE15T3Jn
IFJvb3QgQ0ExHzAdBgkqhkiG9w0BCQEWEGFkbWluQG15b3JnLmNvbTAeFw0yNDA5
MjYwMDAwMDBaFw0yNTA5MjYwMDAwMDBaMIGOMQswCQYDVQQGEwJVUzETMBEGA1UE
CAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNjbzEPMA0GA1UECgwG
TXlPcmcxEDAOBgNVBAsMB015VW5pdDEVMBMGA1UEAwwMTXlPcmcgUm9vdCAQ0ExH
zAdBgkqhkiG9w0BCQEWEGFkbWluQG15b3JnLmNvbTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABE6T/iR9n6p5H//7gM0b8yGf1A9gPzN5T5eA3/0z0tIu0tq9vKz9
n9qI/Q5tP5hB2XvR4t+A2Q/BvL+q+G2y6N8wDQYJKoZIhvcNAQELBQADgYEASh3+
-----END CERTIFICATE-----"""
    
    findings = parser.parse_content("cert.pem", pem_cert)
    assert len(findings) == 1
    f = findings[0]
    
    assert f.asset_type == AssetType.X509_CERTIFICATE
    assert f.algorithm == "EC"
    assert "fingerprint" in f.parameters
    assert f.private_key_redacted is False  # Public certs don't have private keys
    
def test_private_key_redaction():
    parser = CryptoAssetParser()
    
    # Private key
    private_key = """-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAz/3/
-----END RSA PRIVATE KEY-----"""
    
    findings = parser.parse_content("key.pem", private_key)
    assert len(findings) == 1
    f = findings[0]
    
    assert f.asset_type == AssetType.PRIVATE_KEY
    assert f.algorithm == "RSA"
    assert f.private_key_redacted is True
    assert "MIIEp" not in str(f.parameters) # Private key material shouldn't be extracted

def test_jwt_parsing():
    parser = CryptoAssetParser()
    
    # Typical base64 header 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' -> {"alg":"HS256","typ":"JWT"}
    # payload 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ'
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    
    findings = parser.parse_content("config.json", f'"token": "{jwt}"')
    assert len(findings) == 1
    f = findings[0]
    
    assert f.asset_type == AssetType.JWT
    assert f.algorithm == "HS256"
    assert f.parameters["typ"] == "JWT"

def test_ssh_public_key():
    parser = CryptoAssetParser()
    
    ssh_pub = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAO33Y253gW0X2sH4sF9bE2rF4u4zJz0e3wL7U4eC3a3 user@host"
    findings = parser.parse_content("authorized_keys", ssh_pub)
    
    assert len(findings) == 1
    f = findings[0]
    assert f.asset_type == AssetType.SSH_KEY
    assert f.algorithm == "ssh-ed25519"
    assert "fingerprint" in f.parameters
