import React from 'react';
import {
 ShieldAlert,
 ShieldCheck,
 Zap,
 ExternalLink,
 Atom,
} from 'lucide-react';
import { ExecutiveOverviewView as ExecutiveOverviewData, EvidenceFinding } from '../../types';

interface Props {
 data: ExecutiveOverviewData;
 evidenceLookup: Record<string, EvidenceFinding>;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const ExecutiveOverviewView: React.FC<Props> = ({
 data,
 evidenceLookup,
 onOpenEvidence,
}) => {
 const allFindingIds = Object.keys(evidenceLookup);

 const getScoreColor = (score: number) => {
 if (score >= 80) return 'text-success border-success bg-surface-2';
 if (score >= 50) return 'text-high border-high bg-surface-2';
 return 'text-critical border-critical bg-surface-2';
 };

 return (
 <div className="space-y-6">
 {/* Top Banner: Enterprise Posture Gauge & CI/CD Status */}
 <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
 {/* Posture Score Gauge */}
 <div className="lg:col-span-5 glass-panel p-8 flex items-center justify-between relative overflow-hidden group">
 <div className="absolute right-0 top-0 w-64 h-64 bg-brand/10 rounded-full blur-3xl pointer-events-none group-hover:bg-brand/20 transition-all duration-500" />
 <div>
 <div className="flex items-center gap-2 mb-1">
 <ShieldAlert className="w-4 h-4 text-crypto" />
 <span className="text-xs uppercase tracking-wider font-semibold text-text-secondary">
 Enterprise Posture Index
 </span>
 </div>
 <h3 className="text-3xl font-display font-bold text-text-brand tracking-tight">Cryptographic Health</h3>
 <p className="text-xs text-text-secondary mt-1 max-w-xs">
 Algorithmic strength, key lengths, quantum horizons, and policy adherence.
 </p>
 <div className="mt-4 flex items-center gap-3">
 <span
 className={`px-3 py-1 rounded-full text-xs font-semibold border ${
 data.posture_rating === 'STRONG'
 ? 'bg-surface-2 text-success border-success'
 : data.posture_rating === 'NEEDS_ATTENTION'
 ? 'bg-surface-2 text-high border-high'
 : 'bg-surface-2 text-critical border-critical'
 }`}
 >
 Posture: {data.posture_rating.replace('_', ' ')}
 </span>
 <button
 onClick={() =>
 onOpenEvidence(
 'All Cryptographic Assets',
 'Aggregated evidence across full enterprise inventory',
 allFindingIds
 )
 }
 className="text-xs text-brand hover:text-brand/80 inline-flex items-center gap-1 font-medium transition-colors"
 >
 <span>View Evidence ({allFindingIds.length})</span>
 <ExternalLink className="w-3 h-3" />
 </button>
 </div>
 </div>

 <div
 onClick={() =>
 onOpenEvidence(
 'Posture Score Evidence',
 `Evidence driving posture rating ${data.posture_score}/100`,
 allFindingIds
 )
 }
 className={`w-28 h-28 rounded-2xl border-2 flex flex-col items-center justify-center cursor-pointer hover:scale-105 transition-transform ${getScoreColor(
 data.posture_score
 )}`}
 title="Click to view all findings influencing posture score"
 >
 <span className="text-5xl font-display font-extrabold tracking-tighter">{data.posture_score}</span>
 <span className="text-[10px] uppercase font-mono tracking-widest text-text-secondary mt-1">
 Score / 100
 </span>
 </div>
 </div>

 {/* CI/CD Gate Status & Quick Metrics */}
 <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
 <div
 onClick={() => {
 const critIds = Object.values(evidenceLookup)
 .filter((f) => f.severity === 'Critical')
 .map((f) => f.id);
 onOpenEvidence(
 'CI/CD Gate Impact Evidence',
 data.overall_cicd_pass
 ? 'All cryptographic checks passed'
 : `${critIds.length} critical findings blocking automated deployments`,
 critIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-border-soft transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 CI/CD Gate
 </span>
 {data.overall_cicd_pass ? (
 <ShieldCheck className="w-5 h-5 text-success" />
 ) : (
 <ShieldAlert className="w-5 h-5 text-critical animate-pulse" />
 )}
 </div>
 <div className="text-xl font-bold text-text-brand flex items-center gap-2">
 <span
 className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
 data.overall_cicd_pass
 ? 'bg-surface-2 text-success border border-success'
 : 'bg-surface-2 text-critical border border-critical'
 }`}
 >
 {data.overall_cicd_pass ? 'PASSED' : 'BLOCKED'}
 </span>
 </div>
 <p className="text-xs text-text-secondary mt-2 group-hover:text-crypto transition-colors flex items-center gap-1">
 <span>Inspect Gate Findings</span>
 <ExternalLink className="w-3 h-3" />
 </p>
 </div>

 <div
 onClick={() => {
 const qIds = Object.values(evidenceLookup)
 .filter((f) => f.mosca_status === 'AT_RISK' || f.mosca_status === 'CRITICAL_URGENT')
 .map((f) => f.id);
 onOpenEvidence(
 'PQC Threat Horizon Evidence',
 `${data.quantum_risk_count} assets vulnerable to Shor or Grover algorithms`,
 qIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-border-soft transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Quantum Threat
 </span>
 <Atom className="w-5 h-5 text-high" />
 </div>
 <div className="text-2xl font-bold text-high">
 {data.quantum_risk_count}
 <span className="text-xs text-text-secondary font-normal ml-1.5">Assets at risk</span>
 </div>
 <p className="text-xs text-text-secondary mt-2 group-hover:text-crypto transition-colors flex items-center gap-1">
 <span>View Mosca Deficits</span>
 <ExternalLink className="w-3 h-3" />
 </p>
 </div>

 <div
 onClick={() => {
 const qwIds = Object.values(evidenceLookup)
 .filter(
 (f) =>
 f.algorithm.includes('MD5') ||
 f.algorithm.includes('SHA-1') ||
 f.key_size === 1024
 )
 .map((f) => f.id);
 onOpenEvidence(
 'Remediation Quick Wins Evidence',
 `${data.quick_wins_count} low-complexity, 1-line patch candidates`,
 qwIds
 );
 }}
 className="glass-card p-5 cursor-pointer hover:border-border-soft transition-all group"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 Quick Wins
 </span>
 <Zap className="w-5 h-5 text-success" />
 </div>
 <div className="text-2xl font-bold text-success">
 {data.quick_wins_count}
 <span className="text-xs text-text-secondary font-normal ml-1.5">Patches ready</span>
 </div>
 <p className="text-xs text-text-secondary mt-2 group-hover:text-crypto transition-colors flex items-center gap-1">
 <span>Review 1-Click Fixes</span>
 <ExternalLink className="w-3 h-3" />
 </p>
 </div>
 </div>
 </div>

 {/* 4 Executive KPI Cards (Every single count links directly to evidence) */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {data.kpis.map((kpi) => {
 const evidenceList =
 kpi.evidence_items && kpi.evidence_items.length > 0
 ? kpi.evidence_items
 : Object.values(evidenceLookup)
 .filter((f) => {
 if (kpi.id === 'kpi_critical_findings') return f.severity === 'Critical';
 if (kpi.id === 'kpi_quantum_threat')
 return f.mosca_status === 'AT_RISK' || f.mosca_status === 'CRITICAL_URGENT';
 if (kpi.id === 'kpi_pqc_readiness') return f.mosca_status === 'SAFE';
 return true;
 })
 .map((f) => f.id);

 return (
 <div
 key={kpi.id}
 onClick={() =>
 onOpenEvidence(
 `Evidence: ${kpi.title || kpi.label}`,
 `Showing ${evidenceList.length} evidence records backing this metric`,
 evidenceList
 )
 }
 className="glass-card p-5 cursor-pointer hover:border-border-soft hover: hover: transition-all group relative overflow-hidden"
 title="Click to inspect underlying evidence"
 >
 <div className="flex items-center justify-between mb-2">
 <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
 {kpi.title || kpi.label}
 </span>
 <span className="p-1 rounded bg-surface text-text-secondary group-hover:text-crypto group-hover:bg-surface-2 transition-colors">
 <ExternalLink className="w-3.5 h-3.5" />
 </span>
 </div>
 <div className="flex items-baseline gap-2">
 <span className="text-3xl font-extrabold text-text-brand group-hover:text-crypto transition-colors">
 {kpi.value}
 </span>
 <span className="text-[11px] font-medium text-crypto underline decoration-cyan-500/50">
 {evidenceList.length} items
 </span>
 </div>
 {kpi.change && (
 <p className="text-xs text-text-secondary mt-2 flex items-center gap-1 font-mono">
 {kpi.change}
 </p>
 )}
 </div>
 );
 })}
 </div>

 {/* Severity Breakdown Strip (Every badge links to evidence) */}
 <div className="glass-card p-5">
 <div className="flex items-center justify-between mb-4">
 <div>
 <h4 className="text-sm font-semibold text-text-brand">
 Severity Distribution & Asset Exposure
 </h4>
 <p className="text-xs text-text-secondary">
 Click any severity tier to filter underlying cryptographic findings and source locations.
 </p>
 </div>
 <span className="text-xs font-mono text-text-secondary">
 Total Findings: {data.total_findings}
 </span>
 </div>

 <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
 {[
 {
 level: 'Critical',
 count: data.critical_findings,
 badgeBg: 'bg-surface-2 border-critical text-critical hover:border-critical',
 filter: 'Critical',
 },
 {
 level: 'High',
 count: data.high_findings,
 badgeBg: 'bg-surface-2 border-high text-high hover:border-high',
 filter: 'High',
 },
 {
 level: 'Medium',
 count: data.medium_findings,
 badgeBg: 'bg-surface-2 border-border text-medium hover:border-medium',
 filter: 'Medium',
 },
 {
 level: 'Low',
 count: data.low_findings,
 badgeBg: 'bg-surface-2 border-border text-info hover:border-info',
 filter: 'Low',
 },
 {
 level: 'Info',
 count: data.info_findings,
 badgeBg: 'bg-surface border-border-soft text-text-secondary hover:border-border-soft',
 filter: 'Informational',
 },
 ].map((sev) => {
 const sevEvidenceIds = Object.values(evidenceLookup)
 .filter((f) => f.severity === sev.filter)
 .map((f) => f.id);

 return (
 <div
 key={sev.level}
 onClick={() =>
 onOpenEvidence(
 `Evidence: ${sev.level} Severity Findings`,
 `Showing ${sevEvidenceIds.length} records classified as ${sev.level}`,
 sevEvidenceIds
 )
 }
 className={`p-3.5 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between ${sev.badgeBg}`}
 title={`Click to view ${sev.count} ${sev.level} evidence items`}
 >
 <div className="flex items-center justify-between text-xs font-semibold">
 <span>{sev.level}</span>
 <ExternalLink className="w-3 h-3 opacity-60" />
 </div>
 <div className="text-2xl font-bold mt-2">{sev.count}</div>
 <span className="text-[10px] opacity-75 mt-1">Click for evidence</span>
 </div>
 );
 })}
 </div>
 </div>
 </div>
 );
};
