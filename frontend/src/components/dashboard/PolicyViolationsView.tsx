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
            <FileWarning className="w-5 h-5 text-rose-400" />
            <h3 className="text-lg font-bold text-slate-100">Cryptographic Policy Violations & CI/CD Compliance</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Active enforcement rules defined under policy profile <span className="font-mono text-cyan-300 font-semibold">{data.active_profile}</span>.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-950/70 border border-rose-700/60 text-rose-300">
            {data.total_violations} Total Rule Violations
          </span>
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-950/70 border border-amber-700/60 text-amber-300">
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
              className="glass-card p-5 hover:border-slate-700 transition-all group min-w-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="shrink-0">
                    <ShieldAlert
                      className={`w-5 h-5 ${isBlocker ? 'text-rose-400' : 'text-amber-400'}`}
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-100 text-sm group-hover:text-cyan-300 transition-colors truncate" title={violation.rule_name}>
                      {violation.rule_name}
                    </h4>
                    <span className="text-[10px] font-mono text-slate-400 block truncate" title={violation.rule_id}>{violation.rule_id}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${
                      violation.severity === 'Critical'
                        ? 'bg-rose-950/80 border-rose-500 text-rose-300'
                        : 'bg-amber-950/80 border-amber-500 text-amber-300'
                    }`}
                  >
                    {violation.severity}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${
                      isBlocker
                        ? 'bg-rose-950 text-rose-300 border border-rose-700'
                        : 'bg-slate-800 text-slate-300 border border-slate-700'
                    }`}
                  >
                    {violation.threshold}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-300 my-2">{violation.description}</p>

              {/* Action row with clickable evidence link */}
              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <button
                  onClick={() =>
                    onOpenEvidence(
                      `Policy Violation Evidence: ${violation.rule_id}`,
                      `Showing all ${violation.affected_count} assets violating rule '${violation.rule_name}'`,
                      evidenceList
                    )
                  }
                  className="text-cyan-400 hover:text-cyan-300 font-semibold inline-flex items-center gap-1 transition-colors"
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
                  className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium border border-slate-700 transition-colors"
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
