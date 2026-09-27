"""
ECDAT Certificate Intelligence & Inventory Engine (Phase 5.2)

Tracks:
- subject
- issuer
- SAN
- validity
- public-key algorithm
- public-key size
- signature algorithm
- chain
- trust context
- endpoint usage
- owner
- environment
- renewal state

Detects:
- expired
- expiring
- weak keys
- deprecated signatures
- invalid chains
- inconsistent deployments

INVARIANT: Never store private key material.
"""

import fnmatch
import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta
from enum import Enum
from pathlib import Path
from typing import List, Dict, Any, Optional, Set

from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model import Property
from cyclonedx.model.crypto import (
    CryptoProperties,
    CryptoAssetType,
    CertificateProperties,
    AlgorithmProperties,
)
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence

logger = logging.getLogger("ECDAT.CertIntelligence")

PRIVATE_KEY_MARKERS = [
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN DSA PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
]


class RenewalState(str, Enum):
    OK = "OK"
    EXPIRING_SOON = "EXPIRING_SOON"  # <= 30 days
    CRITICAL_EXPIRING = "CRITICAL_EXPIRING"  # <= 7 days
    EXPIRED = "EXPIRED"
    NOT_YET_VALID = "NOT_YET_VALID"
    RENEWED = "RENEWED"


class TrustStatus(str, Enum):
    TRUSTED = "trusted"
    SELF_SIGNED = "self_signed"
    UNTRUSTED_ROOT = "untrusted_root"
    INVALID_CHAIN = "invalid_chain"
    UNKNOWN = "unknown"


def assert_no_private_key(content: Any):
    """Strict guard: raises ValueError if any private key marker is detected."""
    if not content:
        return
    text = str(content)
    for marker in PRIVATE_KEY_MARKERS:
        if marker in text:
            raise ValueError(
                "SECURITY VIOLATION: Private key material detected! "
                "ECDAT Certificate Intelligence strictly forbids storing or processing private keys."
            )


@dataclass
class EndpointUsage:
    endpoint: str  # host:port
    host: str
    port: int
    protocol: str = "TLS"
    first_seen: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    last_seen: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    sni: Optional[str] = None


@dataclass
class CertificateInventoryItem:
    fingerprint_sha256: str
    serial_number: str
    subject: str
    issuer: str
    san: List[str] = field(default_factory=list)
    not_before: str = ""
    not_after: str = ""
    days_until_expiration: int = 0
    public_key_algorithm: str = "RSA"
    public_key_size: Optional[int] = 2048
    signature_algorithm: str = "sha256WithRSAEncryption"
    chain: List[Dict[str, Any]] = field(default_factory=list)
    chain_fingerprints: List[str] = field(default_factory=list)
    trust_context: Dict[str, Any] = field(default_factory=lambda: {"trust_status": "unknown"})
    endpoint_usage: List[Dict[str, Any]] = field(default_factory=list)
    owner: str = "unassigned"
    environment: str = "production"
    renewal_state: str = RenewalState.OK.value
    detected_anomalies: List[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def __post_init__(self):
        # Enforce zero private key storage invariant
        for v in [self.subject, self.issuer, self.fingerprint_sha256, self.owner, str(self.chain)]:
            assert_no_private_key(v)


class CertificateInventory:
    """
    Unified Certificate Inventory managing lifecycle tracking, anomaly detection,
    and CycloneDX 1.6 CBOM generation without private key storage.
    """

    def __init__(self, warning_days: int = 30, critical_days: int = 7):
        self.warning_days = warning_days
        self.critical_days = critical_days
        self._inventory: Dict[str, CertificateInventoryItem] = {}

    def get(self, fingerprint: str) -> Optional[CertificateInventoryItem]:
        return self._inventory.get(fingerprint.lower())

    def all_items(self) -> List[CertificateInventoryItem]:
        return list(self._inventory.values())

    def add_or_update_certificate(
        self,
        cert_data: Dict[str, Any],
        chain: Optional[List[Dict[str, Any]]] = None,
        endpoint: Optional[Dict[str, Any]] = None,
        owner: Optional[str] = None,
        environment: str = "production",
    ) -> CertificateInventoryItem:
        """
        Adds or updates a certificate in the inventory and evaluates its renewal state & anomalies.
        """
        assert_no_private_key(cert_data)
        if chain:
            for c in chain:
                assert_no_private_key(c)

        fp = (
            cert_data.get("fingerprint_sha256")
            or cert_data.get("fingerprint")
            or cert_data.get("subjectName", "unknown-fp")
        ).lower()

        now = datetime.now(timezone.utc)
        not_before_str = cert_data.get("notValidBefore") or cert_data.get("not_before", "")
        not_after_str = cert_data.get("notValidAfter") or cert_data.get("not_after", "")

        # Parse validity
        days_until_exp = 0
        is_expired = False
        is_not_yet_valid = False

        if not_after_str:
            try:
                dt_after = datetime.fromisoformat(not_after_str.replace("Z", "+00:00"))
                delta = dt_after - now
                days_until_exp = delta.days
                if now > dt_after:
                    is_expired = True
            except Exception:
                pass

        if not_before_str:
            try:
                dt_before = datetime.fromisoformat(not_before_str.replace("Z", "+00:00"))
                if now < dt_before:
                    is_not_yet_valid = True
            except Exception:
                pass

        # Chain evaluation
        full_chain = chain or [cert_data]
        chain_fingerprints = []
        for c in full_chain:
            c_fp = (c.get("fingerprint_sha256") or c.get("fingerprint") or c.get("subjectName", "")).lower()
            if c_fp:
                chain_fingerprints.append(c_fp)

        # Trust context
        is_self_signed = cert_data.get("isSelfSigned", False)
        if not is_self_signed:
            is_self_signed = cert_data.get("subjectName") == cert_data.get("issuerName")

        trust_status = TrustStatus.TRUSTED.value
        if is_self_signed:
            trust_status = TrustStatus.SELF_SIGNED.value
        elif len(full_chain) == 1:
            trust_status = TrustStatus.UNTRUSTED_ROOT.value

        trust_context = {
            "trust_status": trust_status,
            "is_self_signed": is_self_signed,
            "chain_depth": len(full_chain),
            "is_complete_chain": len(full_chain) > 1 or is_self_signed,
        }

        # Renewal state calculation
        renewal_state = RenewalState.OK.value
        if is_expired:
            renewal_state = RenewalState.EXPIRED.value
        elif is_not_yet_valid:
            renewal_state = RenewalState.NOT_YET_VALID.value
        elif days_until_exp <= self.critical_days:
            renewal_state = RenewalState.CRITICAL_EXPIRING.value
        elif days_until_exp <= self.warning_days:
            renewal_state = RenewalState.EXPIRING_SOON.value

        # Existing record merge
        existing = self._inventory.get(fp)
        endpoints = existing.endpoint_usage if existing else []
        if endpoint:
            ep_key = endpoint.get("endpoint") or f"{endpoint.get('host')}:{endpoint.get('port')}"
            matched_ep = next((e for e in endpoints if e.get("endpoint") == ep_key), None)
            if matched_ep:
                matched_ep["last_seen"] = now.isoformat()
            else:
                new_ep = {
                    "endpoint": ep_key,
                    "host": endpoint.get("host", ""),
                    "port": endpoint.get("port", 443),
                    "protocol": endpoint.get("protocol", "TLS"),
                    "first_seen": now.isoformat(),
                    "last_seen": now.isoformat(),
                    "sni": endpoint.get("sni"),
                }
                endpoints.append(new_ep)

        item = CertificateInventoryItem(
            fingerprint_sha256=fp,
            serial_number=str(cert_data.get("serial_number", "")),
            subject=cert_data.get("subjectName") or cert_data.get("subject", "CN=unknown"),
            issuer=cert_data.get("issuerName") or cert_data.get("issuer", "CN=unknown"),
            san=cert_data.get("sans") or cert_data.get("san", []),
            not_before=not_before_str,
            not_after=not_after_str,
            days_until_expiration=days_until_exp,
            public_key_algorithm=cert_data.get("algo_family") or cert_data.get("public_key_algorithm", "RSA"),
            public_key_size=cert_data.get("key_size") or cert_data.get("public_key_size"),
            signature_algorithm=cert_data.get("signature_algorithm") or "sha256WithRSAEncryption",
            chain=full_chain,
            chain_fingerprints=chain_fingerprints,
            trust_context=trust_context,
            endpoint_usage=endpoints,
            owner=owner or (existing.owner if existing else "unassigned"),
            environment=environment or (existing.environment if existing else "production"),
            renewal_state=renewal_state,
            created_at=existing.created_at if existing else now.isoformat(),
            updated_at=now.isoformat(),
        )

        self._inventory[fp] = item
        self._detect_item_anomalies(item)
        return item

    def _detect_item_anomalies(self, item: CertificateInventoryItem):
        """
        Detects anomalies on an individual certificate item:
        - expired
        - expiring
        - weak keys
        - deprecated signatures
        - invalid chains
        """
        anomalies: Set[str] = set()

        # 1. Expired
        if item.renewal_state == RenewalState.EXPIRED.value or item.days_until_expiration < 0:
            anomalies.add("expired")

        # 2. Expiring
        if item.renewal_state in (RenewalState.EXPIRING_SOON.value, RenewalState.CRITICAL_EXPIRING.value):
            anomalies.add("expiring")

        # 3. Weak keys
        algo = item.public_key_algorithm.upper()
        size = item.public_key_size
        if algo == "RSA" and size and size < 2048:
            anomalies.add("weak_keys")
        elif algo in ("EC", "ECDSA") and size and size < 224:
            anomalies.add("weak_keys")
        elif algo == "DSA" and size and size < 2048:
            anomalies.add("weak_keys")

        # 4. Deprecated signatures
        sig = item.signature_algorithm.lower()
        if "md5" in sig or "sha1" in sig:
            anomalies.add("deprecated_signatures")

        # 5. Invalid chains
        if len(item.chain) > 1:
            for i in range(len(item.chain) - 1):
                child = item.chain[i]
                parent = item.chain[i + 1]
                c_issuer = child.get("issuerName") or child.get("issuer")
                p_subject = parent.get("subjectName") or parent.get("subject")
                if c_issuer and p_subject and c_issuer != p_subject:
                    anomalies.add("invalid_chains")
                    break
        elif not item.trust_context.get("is_self_signed", False):
            # Single non-self-signed certificate missing intermediate chain
            anomalies.add("invalid_chains")

        item.detected_anomalies = sorted(list(anomalies))

    def detect_inconsistent_deployments(self) -> Dict[str, List[str]]:
        """
        Detects inconsistent deployments across the inventory:
        1. Multiple differing certificates serving the same endpoint hostname
        2. Hostname mismatch between endpoint and certificate SAN / CN
        3. Self-signed or test certificate deployed in production
        """
        inconsistencies: Dict[str, List[str]] = {}

        # 1. Map hostnames to certificates
        host_to_certs: Dict[str, List[CertificateInventoryItem]] = {}
        for item in self._inventory.values():
            for ep in item.endpoint_usage:
                host = ep.get("host", "").lower()
                if host:
                    host_to_certs.setdefault(host, []).append(item)

        for host, cert_list in host_to_certs.items():
            unique_fps = list(dict.fromkeys(c.fingerprint_sha256 for c in cert_list))
            if len(unique_fps) > 1:
                # Same host served by different certificates
                for c in cert_list:
                    msg = f"inconsistent_deployments:multiple_certificates_for_host:{host}"
                    if msg not in c.detected_anomalies:
                        c.detected_anomalies.append(msg)
                    inconsistencies.setdefault(c.fingerprint_sha256, []).append(msg)

        # 2. Hostname mismatch & production self-signed check
        for item in self._inventory.values():
            # Check SAN / CN against endpoints
            cert_names = [item.subject.lower()] + [s.lower() for s in item.san]
            for ep in item.endpoint_usage:
                h = ep.get("host", "").lower()
                if h and not any(fnmatch.fnmatch(h, pattern) or h in pattern for pattern in cert_names):
                    msg = f"inconsistent_deployments:hostname_mismatch:{h}"
                    if msg not in item.detected_anomalies:
                        item.detected_anomalies.append(msg)
                    inconsistencies.setdefault(item.fingerprint_sha256, []).append(msg)

            # Check self-signed in production
            if item.environment == "production" and item.trust_context.get("is_self_signed"):
                msg = "inconsistent_deployments:production_self_signed"
                if msg not in item.detected_anomalies:
                    item.detected_anomalies.append(msg)
                inconsistencies.setdefault(item.fingerprint_sha256, []).append(msg)

        # Detect renewed superseded certificates
        for item in self._inventory.values():
            if item.renewal_state == RenewalState.EXPIRED.value:
                # Look for a valid cert with same subject and SANs
                for other in self._inventory.values():
                    if other.fingerprint_sha256 != item.fingerprint_sha256 and other.subject == item.subject:
                        if other.renewal_state in (RenewalState.OK.value, RenewalState.EXPIRING_SOON.value):
                            item.renewal_state = RenewalState.RENEWED.value
                            break

        return inconsistencies

    def ingest_from_network_finding(
        self,
        finding: Any,
        owner: Optional[str] = None,
        environment: str = "production",
    ) -> List[CertificateInventoryItem]:
        """
        Ingests certificates and endpoint usage from a NetworkCryptoFinding.
        """
        items = []
        if not getattr(finding, "cert_chain", None):
            return items

        chain = finding.cert_chain
        leaf = chain[0]
        endpoint = {
            "endpoint": f"{finding.host}:{finding.port}",
            "host": finding.host,
            "port": finding.port,
            "protocol": getattr(finding, "protocol", "TLS"),
        }

        item = self.add_or_update_certificate(
            cert_data=leaf,
            chain=chain,
            endpoint=endpoint,
            owner=owner,
            environment=environment,
        )
        items.append(item)
        self.detect_inconsistent_deployments()
        return items

    def get_renewal_summary(self) -> Dict[str, Any]:
        """
        Aggregates summary statistics across the certificate inventory.
        """
        self.detect_inconsistent_deployments()
        summary = {
            "total_certificates": len(self._inventory),
            "renewal_states": {
                RenewalState.OK.value: 0,
                RenewalState.EXPIRING_SOON.value: 0,
                RenewalState.CRITICAL_EXPIRING.value: 0,
                RenewalState.EXPIRED.value: 0,
                RenewalState.NOT_YET_VALID.value: 0,
                RenewalState.RENEWED.value: 0,
            },
            "anomalies": {
                "expired": 0,
                "expiring": 0,
                "weak_keys": 0,
                "deprecated_signatures": 0,
                "invalid_chains": 0,
                "inconsistent_deployments": 0,
            },
            "environments": {},
        }

        for item in self._inventory.values():
            summary["renewal_states"][item.renewal_state] = summary["renewal_states"].get(item.renewal_state, 0) + 1
            summary["environments"][item.environment] = summary["environments"].get(item.environment, 0) + 1

            for a in item.detected_anomalies:
                prefix = a.split(":")[0]
                if prefix in summary["anomalies"]:
                    summary["anomalies"][prefix] += 1

        return summary

    def to_cbom(self) -> Bom:
        """
        Converts certificate inventory into a valid CycloneDX 1.6 Cryptography Bill of Materials.
        """
        self.detect_inconsistent_deployments()
        bom = Bom()

        for item in self._inventory.values():
            comp_ref = f"net:certificate/{item.fingerprint_sha256[:16]}"
            not_b = datetime.fromisoformat(item.not_before) if item.not_before else None
            not_a = datetime.fromisoformat(item.not_after) if item.not_after else None

            cert_props = CertificateProperties(
                subject_name=item.subject,
                issuer_name=item.issuer,
                not_valid_before=not_b,
                not_valid_after=not_a,
                certificate_format="X.509",
            )
            crypto_props = CryptoProperties(
                asset_type=CryptoAssetType.CERTIFICATE,
                certificate_properties=cert_props,
            )

            comp = Component(
                type=ComponentType.CRYPTOGRAPHIC_ASSET,
                name=f"Certificate: {item.subject}",
                bom_ref=comp_ref,
                crypto_properties=crypto_props,
            )

            comp.properties.add(Property(name="ecdat:fingerprint", value=item.fingerprint_sha256))
            comp.properties.add(Property(name="ecdat:serialNumber", value=item.serial_number))
            comp.properties.add(Property(name="ecdat:owner", value=item.owner))
            comp.properties.add(Property(name="ecdat:environment", value=item.environment))
            comp.properties.add(Property(name="ecdat:renewalState", value=item.renewal_state))
            comp.properties.add(Property(name="ecdat:daysUntilExpiration", value=str(item.days_until_expiration)))
            comp.properties.add(Property(name="ecdat:publicKeyAlgorithm", value=item.public_key_algorithm))
            if item.public_key_size:
                comp.properties.add(Property(name="ecdat:publicKeySize", value=str(item.public_key_size)))
            comp.properties.add(Property(name="ecdat:signatureAlgorithm", value=item.signature_algorithm))
            if item.san:
                comp.properties.add(Property(name="ecdat:san", value=",".join(item.san)))
            if item.detected_anomalies:
                comp.properties.add(Property(name="ecdat:detectedAnomalies", value=",".join(item.detected_anomalies)))

            endpoints_str = ",".join(e.get("endpoint", "") for e in item.endpoint_usage)
            if endpoints_str:
                comp.properties.add(Property(name="ecdat:endpointUsage", value=endpoints_str))

            bom.components.add(comp)

        return bom

    def save_to_file(self, file_path: str | Path):
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "version": "1.0",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "summary": self.get_renewal_summary(),
            "certificates": [asdict(item) for item in self._inventory.values()],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load_from_file(cls, file_path: str | Path) -> "CertificateInventory":
        inv = cls()
        path = Path(file_path)
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for cert in data.get("certificates", []):
            inv.add_or_update_certificate(
                cert_data=cert,
                chain=cert.get("chain"),
                owner=cert.get("owner"),
                environment=cert.get("environment", "production"),
            )
        inv.detect_inconsistent_deployments()
        return inv
