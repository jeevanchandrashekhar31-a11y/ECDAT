import React from 'react';
import {
  Flame,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { RiskHeatmapView as RiskHeatmapData } from '../../types';

interface Props {
  data: RiskHeatmapData;
  onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const RiskHeatmapView: React.FC<Props> = ({
  data,
  onOpenEvidence,
}) => {
  const impacts = ['Critical', 'High', 'Medium', 'Low'];
  const likelihoods = ['Urgent', 'High', 'Medium', 'Low'];

  const getCell = (impact: string, likelihood: string) => {
    return data.matrix.find(
      (c) => c.impact.toLowerCase() === impact.toLowerCase() && c.likelihood.toLowerCase() === likelihood.toLowerCase()
    );
  };

  const activeCells = data.matrix.filter((c) => c.count > 0);

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-rose-400" />
            <h3 className="text-lg font-bold text-slate-100">Enterprise Cryptographic Risk Heatmap</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            2D assessment matrix correlating Classical Impact Severity with Quantum Threat Likelihood (Mosca horizon).
            Click any cell to inspect linked cryptographic findings.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-950/70 border border-rose-700/60 text-rose-300">
            {data.active_hotspots_count} Active Hotspot Cells
          </span>
        </div>
      </div>

      {/* 2D Interactive Matrix */}
      <div className="glass-card p-6">
        <div className="overflow-x-auto">
          <div className="min-w-[550px]">
            {/* Column Headers (Likelihood) */}
            <div className="grid grid-cols-5 gap-3 mb-2">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-center font-mono">
                Impact \ Mosca Likelihood
              </div>
              {likelihoods.map((l) => (
                <div
                  key={l}
                  className="text-xs font-bold text-center text-slate-300 uppercase tracking-wider py-1.5 bg-slate-950/60 rounded-lg border border-slate-800 font-mono"
                >
                  {l}
                </div>
              ))}
            </div>

            {/* Matrix Rows */}
            {impacts.map((impact) => (
              <div key={impact} className="grid grid-cols-5 gap-3 mb-3">
                {/* Row Header */}
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider py-4 px-3 bg-slate-950/60 rounded-lg border border-slate-800 flex items-center justify-between font-mono">
                  <span>{impact}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${
                      impact === 'Critical'
                        ? 'bg-rose-500'
                        : impact === 'High'
                        ? 'bg-amber-500'
                        : impact === 'Medium'
                        ? 'bg-yellow-500'
                        : 'bg-sky-500'
                    }`}
                  />
                </div>

                {/* 4 Likelihood Cells for this Impact */}
                {likelihoods.map((likelihood) => {
                  const cell = getCell(impact, likelihood);
                  const count = cell ? cell.count : 0;
                  const evidenceList = cell?.evidence_items || [];

                  return (
                    <div
                      key={`${impact}-${likelihood}`}
                      onClick={() => {
                        if (count > 0) {
                          onOpenEvidence(
                            `Risk Heatmap: [${impact} × ${likelihood}]`,
                            `Showing ${count} cryptographic findings located in this risk sector`,
                            evidenceList
                          );
                        }
                      }}
                      className={`h-24 p-3 rounded-xl border flex flex-col justify-between transition-all ${
                        count > 0
                          ? `${cell?.colorClass || 'bg-slate-900 border-slate-700'} cursor-pointer hover:scale-105 hover:shadow-xl`
                          : 'bg-slate-950/40 border-slate-850 text-slate-600 cursor-default'
                      }`}
                      title={
                        count > 0
                          ? `Click to view ${count} evidence items for ${impact} × ${likelihood}`
                          : 'No findings in this cell'
                      }
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono font-semibold">
                        <span className="opacity-75">{impact[0]} × {likelihood[0]}</span>
                        {count > 0 && <ExternalLink className="w-3 h-3 opacity-60" />}
                      </div>

                      <div className="text-center">
                        <span
                          className={`text-2xl font-black ${
                            count > 0 ? 'text-slate-100' : 'text-slate-600'
                          }`}
                        >
                          {count}
                        </span>
                        <span className="block text-[10px] uppercase tracking-wider opacity-80 mt-0.5">
                          {count === 1 ? 'Finding' : 'Findings'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hotspots Breakdown */}
      <div className="glass-card p-5">
        <h4 className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>Active Hotspot Sectors & Priority Queues</span>
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeCells.map((cell) => (
            <div
              key={cell.key}
              onClick={() =>
                onOpenEvidence(
                  `Hotspot Sector: ${cell.impact} Impact × ${cell.likelihood} Likelihood`,
                  `${cell.count} findings requiring prioritized remediation`,
                  cell.evidence_items
                )
              }
              className="p-3.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:border-slate-700 cursor-pointer transition-all flex items-center justify-between group"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-200">
                    {cell.impact} Impact / {cell.likelihood}
                  </span>
                </div>
                <span className="text-[11px] text-cyan-400 group-hover:underline mt-1 block">
                  Click to inspect {cell.count} evidence items
                </span>
              </div>

              <div className="text-xl font-bold px-3 py-1 rounded-lg bg-slate-800 text-slate-100 border border-slate-700">
                {cell.count}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
