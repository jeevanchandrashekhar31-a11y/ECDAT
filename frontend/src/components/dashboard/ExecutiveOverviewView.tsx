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
    if (score >= 80) return 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20';
    if (score >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-950/20';
    return 'text-rose-400 border-rose-500/40 bg-rose-950/20';
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Enterprise Posture Gauge & CI/CD Status */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Posture Score Gauge */}
        <div className="lg:col-span-5 glass-card p-6 flex items-center justify-between relative overflow-hidden">
          <div className="absolute right-0 top-0 w-48 h-48 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="w-4 h-4 text-cyan-400" />
              <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Enterprise Posture Index
              </span>
            </div>
            <h3 className="text-2xl font-bold text-slate-100">Cryptographic Health</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Algorithmic strength, key lengths, quantum horizons, and policy adherence.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                  data.posture_rating === 'STRONG'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                    : data.posture_rating === 'NEEDS_ATTENTION'
                    ? 'bg-amber-950/80 text-amber-300 border-amber-700/50'
                    : 'bg-rose-950/80 text-rose-300 border-rose-700/50'
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
                className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 font-medium transition-colors"
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
            <span className="text-4xl font-extrabold tracking-tight">{data.posture_score}</span>
            <span className="text-[10px] uppercase font-mono tracking-widest text-slate-400">
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
            className="glass-card p-5 cursor-pointer hover:border-slate-700 transition-all group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                CI/CD Gate
              </span>
              {data.overall_cicd_pass ? (
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-rose-400 animate-pulse" />
              )}
            </div>
            <div className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-semibold ${
                  data.overall_cicd_pass
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'bg-rose-950 text-rose-300 border border-rose-700'
                }`}
              >
                {data.overall_cicd_pass ? 'PASSED' : 'BLOCKED'}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-2 group-hover:text-cyan-400 transition-colors flex items-center gap-1">
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
            className="glass-card p-5 cursor-pointer hover:border-slate-700 transition-all group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Quantum Threat
              </span>
              <Atom className="w-5 h-5 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-300">
              {data.quantum_risk_count}
              <span className="text-xs text-slate-400 font-normal ml-1.5">Assets at risk</span>
            </div>
            <p className="text-xs text-slate-400 mt-2 group-hover:text-cyan-400 transition-colors flex items-center gap-1">
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
            className="glass-card p-5 cursor-pointer hover:border-slate-700 transition-all group"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Quick Wins
              </span>
              <Zap className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-300">
              {data.quick_wins_count}
              <span className="text-xs text-slate-400 font-normal ml-1.5">Patches ready</span>
            </div>
            <p className="text-xs text-slate-400 mt-2 group-hover:text-cyan-400 transition-colors flex items-center gap-1">
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
              className="glass-card p-5 cursor-pointer hover:border-cyan-700/60 hover:shadow-cyan-950/20 hover:shadow-lg transition-all group relative overflow-hidden"
              title="Click to inspect underlying evidence"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {kpi.title || kpi.label}
                </span>
                <span className="p-1 rounded bg-slate-800 text-slate-400 group-hover:text-cyan-400 group-hover:bg-slate-750 transition-colors">
                  <ExternalLink className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-slate-100 group-hover:text-cyan-300 transition-colors">
                  {kpi.value}
                </span>
                <span className="text-[11px] font-medium text-cyan-400 underline decoration-cyan-500/50">
                  {evidenceList.length} items
                </span>
              </div>
              {kpi.change && (
                <p className="text-xs text-slate-400 mt-2 flex items-center gap-1 font-mono">
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
            <h4 className="text-sm font-semibold text-slate-200">
              Severity Distribution & Asset Exposure
            </h4>
            <p className="text-xs text-slate-400">
              Click any severity tier to filter underlying cryptographic findings and source locations.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Total Findings: {data.total_findings}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            {
              level: 'Critical',
              count: data.critical_findings,
              badgeBg: 'bg-rose-950/70 border-rose-500/60 text-rose-300 hover:border-rose-400',
              filter: 'Critical',
            },
            {
              level: 'High',
              count: data.high_findings,
              badgeBg: 'bg-amber-950/70 border-amber-500/60 text-amber-300 hover:border-amber-400',
              filter: 'High',
            },
            {
              level: 'Medium',
              count: data.medium_findings,
              badgeBg: 'bg-yellow-950/70 border-yellow-500/60 text-yellow-300 hover:border-yellow-400',
              filter: 'Medium',
            },
            {
              level: 'Low',
              count: data.low_findings,
              badgeBg: 'bg-sky-950/70 border-sky-500/60 text-sky-300 hover:border-sky-400',
              filter: 'Low',
            },
            {
              level: 'Info',
              count: data.info_findings,
              badgeBg: 'bg-slate-800/80 border-slate-700 text-slate-300 hover:border-slate-500',
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
