from typing import Dict, Type
from scanners.network.plugins.base import ProtocolScanner
from scanners.network.plugins.tls import TlsScanner
from scanners.network.plugins.ssh import SshScanner

SCANNER_REGISTRY: Dict[str, Type[ProtocolScanner]] = {
    "tls": TlsScanner,
    "ssh": SshScanner,
}


def get_scanner(protocol: str) -> ProtocolScanner:
    if protocol not in SCANNER_REGISTRY:
        raise ValueError(f"Unsupported protocol plugin: {protocol}")
    return SCANNER_REGISTRY[protocol]()
