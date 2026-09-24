import React from 'react';
import {
 FileWarning,
 ShieldAlert,
 ExternalLink,
} from 'lucide-react';
import { PolicyViolationsView as PolicyViolationsData, EvidenceFinding } from '../../types';

interface Props {
 data: PolicyViolationsData;
 evidenceLookup: Record<string, EvidenceFinding>;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const PolicyViolationsView: React.FC<Props> = ({
 data,
 evidenceLookup,
 onOpenEvidence,
}) => {
 return (
 <div className="space-y-6">
 {/* Header bar */}
 <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2">
 <FileWarning className="w-5 h-5 text-critical" />
 <h3 className="text-lg font-bold text-text-brand">Cryptographic Policy Violations & CI/CD Compliance</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Active enforcement rules defined under policy profile <span className="font-mono text-crypto font-semibold">{data.active_profile}</span>.
 </p>
 </div>

 <div className="flex items-center gap-3">
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 border border-critical text-critical">
 {data.total_violations} Total Rule Violations
 </span>
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 border border-high text-high">
 {data.blocking_violations_count} CI/CD Gate Blockers
 </span>
 </div>
 </div>

 {/* Violations List */}
 <div className="space-y-4">
 {data.violations.map((violation) => {
 const evidenceList =
 violation.evidence_items && violation.evidence_items.length > 0
 ? violation.evidence_items
 : Object.values(evidenceLookup)
 .filter((f) => {
 if (violation.rule_id.includes('RSA')) return f.algorithm.includes('RSA') && (f.key_size || 0) < 2048;
 if (violation.rule_id.includes('MD5')) return f.algorithm.includes('MD5');
 if (violation.rule_id.includes('TLS')) return f.algorithm.includes('TLS 1.0');
 return f.mosca_status === 'AT_RISK';
 })
 .map((f) => f.id);

 const isBlocker = violation.threshold === 'FAIL_CI_HIGH';

 return (
 <div
 key={violation.rule_id}
 className="glass-card p-5 hover:border-border-soft transition-all group min-w-0"
 >
 <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
 <div className="flex items-center gap-2.5 min-w-0">
 <div className="shrink-0">
 <ShieldAlert
 className={`w-5 h-5 ${isBlocker ? 'text-critical' : 'text-high'}`}
 />
 </div>
 <div className="min-w-0">
 <h4 className="font-bold text-text-brand text-sm group-hover:text-crypto transition-colors truncate" title={violation.rule_name}>
 {violation.rule_name}
 </h4>
 <span className="text-[10px] font-mono text-text-secondary block truncate" title={violation.rule_id}>{violation.rule_id}</span>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <span
 className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
 violation.severity === 'Critical'
 ? 'bg-surface-2 border-critical text-critical'
 : 'bg-surface-2 border-high text-high'
 }`}
 >
 {violation.severity}
 </span>
 <span
 className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
 isBlocker
 ? 'bg-surface-2 text-critical border border-critical'
 : 'bg-surface text-text-secondary border border-border-soft'
 }`}
 >
 {violation.threshold}
 </span>
 </div>
 </div>

 <p className="text-xs text-text-secondary my-2">{violation.description}</p>

 {/* Action row with clickable evidence link */}
 <div className="pt-3 border-t border-border flex items-center justify-between text-xs">
 <button
 onClick={() =>
 onOpenEvidence(
 `Policy Violation Evidence: ${violation.rule_id}`,
 `Showing all ${violation.affected_count} assets violating rule '${violation.rule_name}'`,
 evidenceList
 )
 }
 className="text-crypto hover:text-crypto font-semibold inline-flex items-center gap-1 transition-colors"
 >
 <span className="underline decoration-cyan-600/50">
 {violation.affected_count} Failing Occurrences
 </span>
 <ExternalLink className="w-3 h-3" />
 </button>

 <button
 onClick={() =>
 onOpenEvidence(
 `Policy Violation Evidence: ${violation.rule_id}`,
 `Showing all ${violation.affected_count} assets violating rule '${violation.rule_name}'`,
 evidenceList
 )
 }
 className="px-3 py-1 rounded bg-surface hover:bg-surface-2 text-text-brand font-medium border border-border-soft transition-colors"
 >
 Inspect Evidence
 </button>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
};
