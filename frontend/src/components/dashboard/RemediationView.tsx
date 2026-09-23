import React, { useState } from 'react';
import {
  Wrench,
  Zap,
  Copy,
  Check,
  ExternalLink,
  Atom,
} from 'lucide-react';
import { RemediationView as RemediationData } from '../../types';

interface Props {
  data: RemediationData;
  onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const RemediationView: React.FC<Props> = ({
  data,
  onOpenEvidence,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyPatch = (id: string, patch?: string) => {
    if (!patch) return;
    navigator.clipboard.writeText(patch);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">Cryptographic Remediation & Automated Patching</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Prioritized remediation roadmap with instant 1-line unified diff patches and architectural PQC transition plans.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 border border-emerald-700/60 text-emerald-300">
            {data.quick_wins_count} Quick Wins Available
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-violet-950/70 border border-violet-700/60 text-violet-300">
            {data.complex_migrations_count} PQC Migrations
          </span>
        </div>
      </div>

      {/* Section 1: Quick Wins (Immediate 1-Click Code Patches) */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          <h4 className="text-sm font-semibold text-slate-200">
            Quick Wins — Low Effort, Immediate Risk Reduction
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.quick_wins.map((win) => {
            const relatedEvidenceIds = [win.finding_id].filter(Boolean);

            return (
              <div
                key={win.id}
                className="glass-card p-5 flex flex-col justify-between hover:border-emerald-700/60 transition-all group min-w-0"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 shrink-0">
                      QUICK WIN
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 truncate min-w-0 text-right" title={win.finding_id}>{win.finding_id}</span>
                  </div>

                  <h5 className="font-bold text-slate-100 text-sm mb-1">{win.algorithm} Upgrade</h5>
                  <div className="text-xs text-emerald-400 font-mono font-semibold mb-2">
                    Target: {win.recommended_target}
                  </div>
                  <p className="text-xs text-slate-300 mb-3">{win.rationale}</p>

                  {/* Unified Diff */}
                  {win.patch_diff && (
                    <div className="relative group/diff mb-3">
                      <pre className="text-[11px] font-mono bg-slate-950 p-2.5 rounded-lg border border-slate-850 overflow-x-auto text-slate-300">
                        {win.patch_diff.split('\n').map((line, lIdx) => {
                          const isAdd = line.startsWith('+');
                          const isDel = line.startsWith('-');
                          return (
                            <div
                              key={lIdx}
                              className={
                                isAdd
                                  ? 'text-emerald-400 bg-emerald-950/30'
                                  : isDel
                                  ? 'text-rose-400 bg-rose-950/30'
                                  : 'text-slate-400'
                              }
                            >
                              {line}
                            </div>
                          );
                        })}
                      </pre>
                      <button
                        onClick={() => handleCopyPatch(win.id, win.patch_diff)}
                        className="absolute right-2 top-2 px-2 py-1 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors inline-flex items-center gap-1"
                        title="Copy unified diff"
                      >
                        {copiedId === win.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Patch</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-slate-500 truncate min-w-0 block" title={`Asset: ${win.asset_id}`}>Asset: {win.asset_id}</span>
                  <button
                    onClick={() =>
                      onOpenEvidence(
                        `Remediation Evidence: ${win.algorithm}`,
                        `Finding context for ${win.finding_id} in ${win.asset_id}`,
                        relatedEvidenceIds
                      )
                    }
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 shrink-0"
                  >
                    <span>Inspect Evidence</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Complex PQC Migrations */}
      <div className="space-y-3 pt-4 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <Atom className="w-4 h-4 text-violet-400" />
          <h4 className="text-sm font-semibold text-slate-200">
            Multi-Phase Post-Quantum Cryptography (PQC) Migrations
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.complex_migrations.map((mig) => {
            const relatedEvidenceIds = [mig.finding_id].filter(Boolean);

            return (
              <div
                key={mig.id}
                className="glass-card p-5 flex flex-col justify-between hover:border-violet-700/60 transition-all group min-w-0"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-violet-950 text-violet-300 border border-violet-800 shrink-0">
                      PQC ROADMAP
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 truncate min-w-0 text-right" title={mig.finding_id}>{mig.finding_id}</span>
                  </div>

                  <h5 className="font-bold text-slate-100 text-sm mb-1">{mig.algorithm} Transition</h5>
                  <div className="text-xs text-violet-400 font-mono font-semibold mb-2">
                    Target: {mig.recommended_target}
                  </div>

                  <p className="text-xs text-slate-300 mb-3">{mig.rationale}</p>

                  <div className="p-3 rounded-lg bg-slate-950/70 border border-slate-850 text-xs font-mono text-slate-300 mb-3">
                    <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                      Migration Plan:
                    </span>
                    {mig.pqc_migration}
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 min-w-0">
                  <span className="text-[10px] font-mono text-slate-500 truncate min-w-0 block" title={`Asset: ${mig.asset_id}`}>Asset: {mig.asset_id}</span>
                  <button
                    onClick={() =>
                      onOpenEvidence(
                        `PQC Migration Evidence: ${mig.algorithm}`,
                        `Horizons and algorithm context for ${mig.finding_id}`,
                        relatedEvidenceIds
                      )
                    }
                    className="text-xs text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 shrink-0"
                  >
                    <span>Inspect Evidence</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
