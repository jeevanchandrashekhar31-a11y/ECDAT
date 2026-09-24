import React from 'react';
import {
 Users,
 ExternalLink,
 Mail,
} from 'lucide-react';
import { OwnershipView as OwnershipData, EvidenceFinding } from '../../types';

interface Props {
 data: OwnershipData;
 evidenceLookup: Record<string, EvidenceFinding>;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const OwnershipView: React.FC<Props> = ({
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
 <Users className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">Asset Ownership & Security Remediation SLAs</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Assign accountability, track mean-time-to-remediate (MTTR), and monitor SLA compliance by engineering team.
 </p>
 </div>

 <div className="flex items-center gap-3">
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data.total_teams} Engineering Teams
 </span>
 {data.unowned_assets_count > 0 && (
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 border border-high text-high">
 {data.unowned_assets_count} Unassigned Assets
 </span>
 )}
 </div>
 </div>

 {/* Teams Grid */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {data.teams.map((team) => {
 const teamEvidenceIds = Object.values(evidenceLookup)
 .filter((f) => team.evidence_asset_ids.includes(f.asset_id || ''))
 .map((f) => f.id);

 const isCompliant = team.sla_compliance_pct >= 90;

 return (
 <div
 key={team.team_name}
 className="glass-card p-5 flex flex-col justify-between hover:border-border-soft transition-all group min-w-0"
 >
 <div>
 <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
 <div className="min-w-0">
 <h4 className="font-bold text-text-brand text-base group-hover:text-crypto transition-colors truncate" title={team.team_name}>
 {team.team_name}
 </h4>
 <span className="text-xs text-text-secondary flex items-center gap-1 mt-0.5 font-mono truncate" title={team.lead}>
 <Mail className="w-3 h-3 text-text-muted shrink-0" />
 <span className="truncate">{team.lead}</span>
 </span>
 </div>

 <span
 className={`px-2 py-0.5 rounded text-xs font-bold ${
 isCompliant
 ? 'bg-surface-2 text-success border border-success'
 : 'bg-surface-2 text-critical border border-critical'
 }`}
 >
 {team.sla_compliance_pct}% SLA
 </span>
 </div>

 {/* Numbers Grid (Every number links to evidence) */}
 <div className="grid grid-cols-3 gap-2 my-3 p-2.5 rounded-lg bg-background/50 border border-border text-center">
 <div
 onClick={() =>
 onOpenEvidence(
 `Assets for ${team.team_name}`,
 `All ${team.asset_count} assets owned by ${team.team_name}`,
 teamEvidenceIds
 )
 }
 className="cursor-pointer hover:bg-bg-1 rounded p-1 transition-colors"
 >
 <span className="text-[10px] text-text-muted block uppercase font-mono">Assets</span>
 <span className="text-base font-bold text-text-brand">{team.asset_count}</span>
 </div>

 <div
 onClick={() => {
 const critIds = Object.values(evidenceLookup)
 .filter((f) => team.evidence_asset_ids.includes(f.asset_id || '') && f.severity === 'Critical')
 .map((f) => f.id);
 onOpenEvidence(
 `Critical Findings: ${team.team_name}`,
 `${team.critical_count} critical findings owned by ${team.team_name}`,
 critIds
 )
 }}
 className="cursor-pointer hover:bg-bg-1 rounded p-1 transition-colors"
 >
 <span className="text-[10px] text-text-muted block uppercase font-mono">Critical</span>
 <span
 className={`text-base font-bold ${
 team.critical_count > 0 ? 'text-critical underline' : 'text-text-secondary'
 }`}
 >
 {team.critical_count}
 </span>
 </div>

 <div
 onClick={() => {
 const highIds = Object.values(evidenceLookup)
 .filter((f) => team.evidence_asset_ids.includes(f.asset_id || '') && f.severity === 'High')
 .map((f) => f.id);
 onOpenEvidence(
 `High Findings: ${team.team_name}`,
 `${team.high_count} high findings owned by ${team.team_name}`,
 highIds
 )
 }}
 className="cursor-pointer hover:bg-bg-1 rounded p-1 transition-colors"
 >
 <span className="text-[10px] text-text-muted block uppercase font-mono">High</span>
 <span
 className={`text-base font-bold ${
 team.high_count > 0 ? 'text-high underline' : 'text-text-secondary'
 }`}
 >
 {team.high_count}
 </span>
 </div>
 </div>
 </div>

 {/* Action */}
 <div className="pt-3 border-t border-border flex items-center justify-between">
 <span className="text-xs text-text-secondary">
 {team.total_findings} total findings
 </span>

 <button
 onClick={() =>
 onOpenEvidence(
 `Team Evidence: ${team.team_name}`,
 `All cryptographic findings allocated to ${team.team_name}`,
 teamEvidenceIds
 )
 }
 className="text-xs text-crypto hover:text-crypto font-medium inline-flex items-center gap-1"
 >
 <span>Inspect Team Evidence</span>
 <ExternalLink className="w-3 h-3" />
 </button>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 );
};
