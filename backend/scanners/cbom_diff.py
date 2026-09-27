"""
CBOM Diff Engine (Phase 8.2)

Compares two Cryptographic Bills of Materials (CBOMs) across scans, releases, or environments.
Categorizes assets into:
- NEW: Asset discovered in current CBOM but absent in baseline.
- REMOVED: Asset observed in baseline but not present in current scan.
  CRITICAL INVARIANT: Never treat absence of a finding as proof that no crypto exists.
  Every REMOVED item includes explicit disclaimer and unverified absence designation.
- CHANGED: Cryptographic technical properties modified (e.g. key size, cipher suites, cert validity).
- UNCHANGED: Cryptographic asset and risk status are identical.
- RISK_CHANGED: Cryptographic asset technical parameters unchanged, but risk severity shifted
  (e.g., Mosca migration deadline reached, Shor vulnerability elevated, CVE detected).
- POLICY_CHANGED: Cryptographic asset parameters unchanged, but policy status shifted
  (e.g., COMPLIANT -> VIOLATION under stricter profile).
"""

import json
from enum import Enum
from typing import Dict, Any, List, Optional, Union
from datetime import datetime, timezone

from cyclonedx.model.bom import Bom
from scanners.cbom_io import normalize_cbom, correlate_cbom


class DiffStatus(str, Enum):
    NEW = "NEW"
    REMOVED = "REMOVED"
    CHANGED = "CHANGED"
    UNCHANGED = "UNCHANGED"
    RISK_CHANGED = "RISK_CHANGED"
    POLICY_CHANGED = "POLICY_CHANGED"


ABSENCE_OF_FINDING_DISCLAIMER = (
    "Absence of finding does not prove non-existence of cryptographic asset. "
    "A missing asset in this scan may reflect altered scan scope, unexecuted code branches, "
    "network timeouts, or ephemeral container termination rather than explicit decommissioning."
)


def _extract_component_map(bom_or_data: Union[Bom, dict, str], policy_profile: str) -> Dict[str, Dict[str, Any]]:
    correlated = correlate_cbom(bom_or_data, policy_profile=policy_profile)
    assets = correlated.get("_correlation", {}).get("assets", [])
    components_by_ref = {c.get("bom-ref"): c for c in correlated.get("components", [])}

    asset_map = {}
    for a in assets:
        ref = a.get("bom_ref") or a.get("name")
        comp = components_by_ref.get(ref, {})
        props = {p.get("name"): p.get("value") for p in comp.get("properties", []) if isinstance(p, dict)}

        # Build normalized comparable representation
        asset_map[ref] = {
            "bom_ref": ref,
            "name": a.get("name"),
            "asset_type": a.get("asset_type"),
            "algorithm": a.get("algorithm"),
            "key_size": a.get("key_size"),
            "risk_level": a.get("risk_level"),
            "policy_status": a.get("policy_status"),
            "quantum_vulnerable": a.get("quantum_vulnerable"),
            "reachability": a.get("reachability"),
            "reasons": a.get("reasons", []),
            "location": props.get("location")
            or (
                comp.get("evidence", {}).get("occurrences", [{}])[0].get("location")
                if comp.get("evidence", {}).get("occurrences")
                else "unknown"
            ),
            "properties": props,
        }
    return asset_map


def diff_cboms(
    baseline_cbom: Union[Bom, dict, str],
    current_cbom: Union[Bom, dict, str],
    policy_profile: str = "internal_enterprise",
) -> Dict[str, Any]:
    """
    Diffs two CBOM documents against each other.
    Categorizes every asset into NEW, REMOVED, CHANGED, UNCHANGED, RISK_CHANGED, or POLICY_CHANGED.
    Strictly preserves the 'never treat absence as proof' invariant for all REMOVED items.
    """
    baseline_map = _extract_component_map(baseline_cbom, policy_profile)
    current_map = _extract_component_map(current_cbom, policy_profile)

    all_refs = set(baseline_map.keys()).union(set(current_map.keys()))
    diff_items = []

    summary = {
        DiffStatus.NEW.value: 0,
        DiffStatus.REMOVED.value: 0,
        DiffStatus.CHANGED.value: 0,
        DiffStatus.UNCHANGED.value: 0,
        DiffStatus.RISK_CHANGED.value: 0,
        DiffStatus.POLICY_CHANGED.value: 0,
    }

    for ref in sorted(all_refs):
        in_baseline = ref in baseline_map
        in_current = ref in current_map

        # 1. NEW
        if not in_baseline and in_current:
            cur = current_map[ref]
            status = DiffStatus.NEW
            item = {
                "bom_ref": ref,
                "name": cur.get("name"),
                "status": status.value,
                "asset_type": cur.get("asset_type"),
                "baseline": None,
                "current": cur,
                "technical_changes": ["Asset newly discovered in current scan"],
                "risk_changes": [],
                "policy_changes": [],
            }
            summary[status.value] += 1
            diff_items.append(item)

        # 2. REMOVED (with invariant guard)
        elif in_baseline and not in_current:
            base = baseline_map[ref]
            status = DiffStatus.REMOVED
            item = {
                "bom_ref": ref,
                "name": base.get("name"),
                "status": status.value,
                "asset_type": base.get("asset_type"),
                "baseline": base,
                "current": None,
                "technical_changes": ["Asset absent from current scan"],
                "risk_changes": [],
                "policy_changes": [],
                # Mandatory Absence Invariant Enforcement
                "absence_proof_disclaimer": ABSENCE_OF_FINDING_DISCLAIMER,
                "is_definitive_absence": False,
                "removal_classification": "UNVERIFIED_ABSENCE",
            }
            summary[status.value] += 1
            diff_items.append(item)

        # 3. Present in both: inspect changes
        else:
            base = baseline_map[ref]
            cur = current_map[ref]

            tech_changes = []
            risk_changes = []
            policy_changes = []

            # Compare technical parameters
            if base.get("algorithm") != cur.get("algorithm"):
                tech_changes.append(f"Algorithm changed: '{base.get('algorithm')}' -> '{cur.get('algorithm')}'")
            if base.get("key_size") != cur.get("key_size"):
                tech_changes.append(f"Key size changed: '{base.get('key_size')}' -> '{cur.get('key_size')}'")
            if base.get("reachability") != cur.get("reachability"):
                tech_changes.append(
                    f"Reachability changed: '{base.get('reachability')}' -> '{cur.get('reachability')}'"
                )
            if base.get("location") != cur.get("location"):
                tech_changes.append(f"Location changed: '{base.get('location')}' -> '{cur.get('location')}'")

            # Compare risk and policy
            if base.get("risk_level") != cur.get("risk_level"):
                risk_changes.append(f"Risk level changed: '{base.get('risk_level')}' -> '{cur.get('risk_level')}'")
            if base.get("quantum_vulnerable") != cur.get("quantum_vulnerable"):
                risk_changes.append(
                    f"Quantum vulnerability status changed: '{base.get('quantum_vulnerable')}' -> '{cur.get('quantum_vulnerable')}'"
                )

            if base.get("policy_status") != cur.get("policy_status"):
                policy_changes.append(
                    f"Policy compliance changed: '{base.get('policy_status')}' -> '{cur.get('policy_status')}'"
                )

            if tech_changes:
                status = DiffStatus.CHANGED
            elif risk_changes:
                status = DiffStatus.RISK_CHANGED
            elif policy_changes:
                status = DiffStatus.POLICY_CHANGED
            else:
                status = DiffStatus.UNCHANGED

            summary[status.value] += 1
            diff_items.append(
                {
                    "bom_ref": ref,
                    "name": cur.get("name"),
                    "status": status.value,
                    "asset_type": cur.get("asset_type"),
                    "baseline": base,
                    "current": cur,
                    "technical_changes": tech_changes,
                    "risk_changes": risk_changes,
                    "policy_changes": policy_changes,
                }
            )

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "policy_profile": policy_profile,
        "total_baseline_assets": len(baseline_map),
        "total_current_assets": len(current_map),
        "summary": summary,
        "diff_items": diff_items,
        "absence_of_finding_rule": "Absence of a finding is never treated as proof that no crypto exists.",
    }
