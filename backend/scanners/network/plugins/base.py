from typing import Protocol, List
from scanners.models import NetworkCryptoFinding
from scanners.network.target_validation import NormalizedTarget


class ProtocolScanner(Protocol):
    def scan(
        self, targets: List[NormalizedTarget], max_concurrency: int, timeout: int = 15
    ) -> List[NetworkCryptoFinding]:
        """Perform a scan on a list of targets and return findings."""
        ...
