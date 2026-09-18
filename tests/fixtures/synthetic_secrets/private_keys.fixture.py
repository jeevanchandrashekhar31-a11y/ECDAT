"""
# @ecdat-synthetic-corpus
ECDAT Synthetic Secrets Test Corpus - Private Keys Fixture
Certified fake test credentials for testing scanner detection and synthetic discrimination.
"""

# ecdat:synthetic-fixture
SAMPLE_RSA_KEY = (
    "-----BEGIN RSA PRIVATE KEY-----\n"
    "MIIEowIBAAKCAQEA0Y3+secretKeyBytesHereForTestingOnlyNotRealKey1234567890=\n"
    "-----END RSA PRIVATE KEY-----"
)

# ecdat:synthetic-fixture
SAMPLE_EC_KEY = (
    "-----BEGIN EC PRIVATE KEY-----\n"
    "MHcCAQEEIIsecretEcBytesHereForTestingOnlyNotRealKey1234567890=\n"
    "-----END EC PRIVATE KEY-----"
)
