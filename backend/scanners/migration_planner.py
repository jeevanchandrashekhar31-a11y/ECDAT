from typing import List, Dict, Any, Optional, Tuple
import json
import os
from dataclasses import dataclass

@dataclass
class EvidenceOccurrence:
    file: str
    line: int
    api_symbol: Optional[str]
    context_tag: str  # "production"|"test"|"example"|"vendored"|"fixture"
    guard_condition: Optional[str]
    guard_sense: Optional[str]  # "compiled_out_when_defined"|"compiled_out_when_undefined"|None
    evidence_tier: str  # "T1"|"T2"|"T3"|"T4"

@dataclass
class MoscaResult:
    margin_years: float
    quantum_vulnerable: bool
    status: str
    
    def __eq__(self, other):
        if not isinstance(other, MoscaResult): return False
        return self.margin_years == other.margin_years and self.quantum_vulnerable == other.quantum_vulnerable and self.status == other.status

@dataclass
class AssetClassification:
    id: str
    algorithm: str
    total_occurrences: int
    file_count: int
    occurrences_by_context: Dict[str, int]
    guarded_occurrences: int
    reachable_by_default: bool
    reachable_rationale: str
    is_library: bool
    public_api_surface: bool
    downstream_consumer_count: Optional[int]
    base_severity: str
    confidence_level: str  # "high"|"medium"|"low"
    mosca: MoscaResult
    sample_locations: List[str]
    single_call_site_wraps_all_uses: bool = False
    data_sensitivity: str = "unknown"

@dataclass
class RoadmapEntry:
    entry_id: str
    algorithm: str
    context_bucket: str
    priority: str
    priority_score: float
    total_occurrences: int
    file_count: int
    sample_locations: List[str]
    current_state: str
    reachability_statement: str
    migration_complexity: str
    complexity_rationale: str
    mosca: MoscaResult
    standard_reference: str
    assumptions: str
    hybrid_transition_recommended: bool
    hybrid_note: str

def build_current_state(c: AssetClassification) -> str:
    if c.total_occurrences == 1:
        loc = c.sample_locations[0] if c.sample_locations else "unknown"
        return f"{c.algorithm} detected once, at {loc}."
    samples = "; ".join(c.sample_locations[:3])
    more = f", and {c.total_occurrences - len(c.sample_locations[:3])} more location(s)" if c.total_occurrences > 3 else ""
    return f"{c.algorithm} detected in {c.total_occurrences} occurrence(s) across {c.file_count} file(s). Examples: {samples}{more}."

def compute_priority(c: AssetClassification) -> Tuple[str, float]:
    severity = c.base_severity.capitalize()
    score = {"Critical": 40, "High": 25, "Medium": 12, "Low": 4, "Informational": 0}.get(severity, 0)
    score += 20 if c.reachable_by_default else 0
    prod_n = c.occurrences_by_context.get("production", 0)
    other_n = c.total_occurrences - prod_n
    score += min(20, prod_n * 0.5) + min(4, other_n * 0.05)
    score += 10 if c.public_api_surface else 0
    confidence_mult = {"high": 1.0, "medium": 0.85, "low": 0.6}.get(c.confidence_level.lower(), 1.0)
    score *= confidence_mult
    
    if not c.reachable_by_default and prod_n == 0:
        return "informational", score
        
    if score >= 60: return "critical", score
    if score >= 40: return "high", score
    if score >= 20: return "medium", score
    if score >= 5: return "low", score
    return "informational", score

def compute_migration_complexity(c: AssetClassification) -> Tuple[str, str]:
    behind_abstraction = c.file_count == 1 or c.single_call_site_wraps_all_uses
    if behind_abstraction and not c.public_api_surface:
        return "low", f"All {c.total_occurrences} occurrence(s) route through a single call site; no external API impact detected."
    if c.public_api_surface and c.downstream_consumer_count is None:
        return "unknown", "Exposed on a public API surface; downstream consumer impact could not be determined in this scan."
    if c.file_count > 10:
        return "high", f"Occurrences span {c.file_count} files with no shared abstraction; each call site needs individual migration."
    return "medium", f"Occurrences span {c.file_count} files; a shared migration path is plausible but unconfirmed."

def get_hybrid_logic(algorithm: str, public_api_surface: bool, consumer_count: Optional[int]) -> Tuple[bool, str]:
    cat_path = os.path.join(os.path.dirname(__file__), "..", "..", "rules", "pqc_algorithm_catalog.json")
    catalog = {}
    if os.path.exists(cat_path):
        with open(cat_path, "r") as f:
            catalog = json.load(f)
            
    algorithms_list = catalog.get("algorithms", [])
    algo_info = next(
        (a for a in algorithms_list if 
         a.get("standard_name", "").upper() == algorithm.upper() or 
         algorithm.upper() in [alias.upper() for alias in a.get("aliases", [])]), 
        {}
    )
    
    role = algo_info.get("mechanism_type", "unknown")
    if role not in ["key_exchange", "digital_signature"]:
        return False, f"hybrid not applicable: {algorithm} is a {role}, not a key-establishment primitive"
    
    requires_interop = public_api_surface or (consumer_count is not None and consumer_count > 0)
    if not requires_interop:
        return False, f"hybrid not applicable: {algorithm} is not exposed on public API surface for external interop"
        
    has_hybrid = algo_info.get("hybrid_capable", False)
    if not has_hybrid:
        return False, f"hybrid not applicable: no known hybrid pairing in catalog for {algorithm}"
        
    return True, f"Hybrid transition recommended: {algo_info.get('hybrid_equivalent', 'Generic-Hybrid')} available for interop."

def build_scope_statement(classifications: List[AssetClassification], total_assets: int) -> str:
    total_fed = len(classifications)
    prod_reachable = sum(1 for c in classifications if c.reachable_by_default and c.occurrences_by_context.get("production", 0) > 0)
    excluded = total_fed - prod_reachable
    high_conf = sum(1 for c in classifications if c.confidence_level.lower() == "high")
    low_conf = total_fed - high_conf
    total_occurrences = sum(c.total_occurrences for c in classifications)
    
    return (
        f"Total assets scanned: {total_assets}. "
        f"Assets fed into this roadmap as production-reachable: {prod_reachable}. "
        f"Assets excluded as test-only/guarded-out: {excluded}. "
        f"Confidence breakdown: {high_conf} high confidence, {low_conf} low confidence entries. "
        f"Reconciliation note: Roadmap generated from {total_occurrences} static occurrences across mapped components."
    )

def generate_roadmap(classifications: List[AssetClassification], total_assets: int) -> Dict[str, Any]:
    entries: List[RoadmapEntry] = []
    
    for c in classifications:
        prod_n = c.occurrences_by_context.get("production", 0)
        if prod_n > 0 and c.reachable_by_default:
            context_bucket = "production_default_reachable"
        elif prod_n > 0 and not c.reachable_by_default:
            context_bucket = "production_guarded_out"
        elif prod_n == 0 and c.total_occurrences > 0:
            context_bucket = "test_or_example"
        else:
            context_bucket = "unclassified"
            
        priority, score = compute_priority(c)
        complexity, rationale = compute_migration_complexity(c)
        hybrid_rec, hybrid_note = get_hybrid_logic(c.algorithm, c.public_api_surface, c.downstream_consumer_count)
        
        entry = RoadmapEntry(
            entry_id=f"RM-{c.id}",
            algorithm=c.algorithm,
            context_bucket=context_bucket,
            priority=priority,
            priority_score=score,
            total_occurrences=c.total_occurrences,
            file_count=c.file_count,
            sample_locations=c.sample_locations,
            current_state=build_current_state(c),
            reachability_statement=c.reachable_rationale,
            migration_complexity=complexity,
            complexity_rationale=rationale,
            mosca=c.mosca,
            standard_reference="Derived from ECDAT ruleset",
            assumptions="Assuming standard downstream integrations",
            hybrid_transition_recommended=hybrid_rec,
            hybrid_note=hybrid_note
        )
        
        # Enforce ground rule
        assert entry.mosca == c.mosca, "Mosca copy failed"
        
        entries.append(entry)
        
    phase1_focus = [e.algorithm for e in entries if e.priority in ["critical", "high"] and e.migration_complexity in ["low", "medium"]]
    phase2_focus = [e.algorithm for e in entries if e.priority in ["high"] and e.migration_complexity not in ["low", "medium"]] 
    phase3_focus = [c.algorithm for c in classifications if c.data_sensitivity == "high"]
    phase4_focus = [e.algorithm for e in entries if e.hybrid_transition_recommended]
    phase5_focus = [e.algorithm for e in entries if e.migration_complexity == "unknown"]
    
    return {
        "scope_statement": build_scope_statement(classifications, total_assets),
        "suggested_sequence": {
            "Phase 1 (0-6mo)": list(set(phase1_focus)),
            "Phase 2 (3-12mo)": list(set(phase2_focus)),
            "Phase 3 (6-18mo)": list(set(phase3_focus)),
            "Phase 4 (12-24mo)": list(set(phase4_focus)),
            "Phase 5 (ongoing)": list(set(phase5_focus)),
        },
        "entries": [{"entry_id": e.entry_id, "algorithm": e.algorithm, "context_bucket": e.context_bucket, "priority": e.priority, "priority_score": e.priority_score, "total_occurrences": e.total_occurrences, "file_count": e.file_count, "sample_locations": e.sample_locations, "current_state": e.current_state, "reachability_statement": e.reachability_statement, "migration_complexity": e.migration_complexity, "complexity_rationale": e.complexity_rationale, "mosca": {"margin_years": e.mosca.margin_years, "quantum_vulnerable": e.mosca.quantum_vulnerable, "status": e.mosca.status}, "standard_reference": e.standard_reference, "assumptions": e.assumptions, "hybrid_transition_recommended": e.hybrid_transition_recommended, "hybrid_note": e.hybrid_note} for e in entries]
    }
