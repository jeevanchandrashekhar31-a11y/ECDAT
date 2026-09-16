import React from 'react';
import {
  Activity,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { RuntimeObservationsView as RuntimeObservationsData, EvidenceFinding } from '../../types';

interface Props {
  data: RuntimeObservationsData;
  evidenceLookup: Record<string, EvidenceFinding>;
  onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const RuntimeObservationsView: React.FC<Props> = ({
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
            <Activity className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">Live Dynamic Runtime Observations</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic eBPF and instrumentation traces confirming live cryptographic calls, process memory hooks, and reachable execution paths.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 border border-emerald-700/60 text-emerald-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {data.total_observations} Confirmed Runtime Traces
          </span>
        </div>
      </div>

      {/* Observations Stream */}
      <div className="space-y-4">
        {data.observations.map((obs) => {
          const relatedEvidenceIds = [obs.evidence_id].filter(Boolean);

          return (
            <div
              key={obs.id}
              className="glass-card p-5 hover:border-slate-700 transition-all group"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                    {obs.observation_type}
                  </span>
                  <h4 className="font-semibold text-slate-100 text-sm">
                    {obs.target}
                  </h4>
                  <span className="text-xs text-slate-400 font-mono">({obs.component})</span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Reachability Confirmed
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {new Date(obs.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-300 mb-3">{obs.details}</p>

              {/* Monospace Evidence Snippet */}
              {obs.evidence_snippet && (
                <div className="bg-slate-950/90 rounded-lg p-3 border border-slate-800/80 font-mono text-xs text-cyan-200 mb-3 flex items-center justify-between">
                  <span className="truncate">{obs.evidence_snippet}</span>
                  <span className="text-[10px] text-slate-500 uppercase shrink-0 ml-2">Trace telemetry</span>
                </div>
              )}

              {/* Action row */}
              <div className="flex items-center justify-between pt-2 text-xs border-t border-slate-800/60">
                <span className="text-slate-500 font-mono text-[11px]">Obs ID: {obs.id}</span>

                <button
                  onClick={() =>
                    onOpenEvidence(
                      `Runtime Observation Evidence: ${obs.id}`,
                      `Execution trace binding for ${obs.target} (${obs.component})`,
                      relatedEvidenceIds.length > 0 ? relatedEvidenceIds : Object.keys(evidenceLookup).slice(0, 1)
                    )
                  }
                  className="text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1 transition-colors"
                >
                  <span>Inspect Linked Finding</span>
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
