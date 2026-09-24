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
 <Flame className="w-5 h-5 text-critical" />
 <h3 className="text-lg font-bold text-text-brand">Enterprise Cryptographic Risk Heatmap</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 2D assessment matrix correlating Classical Impact Severity with Quantum Threat Likelihood (Mosca horizon).
 Click any cell to inspect linked cryptographic findings.
 </p>
 </div>

 <div className="flex items-center gap-3">
 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface-2 border border-critical text-critical">
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
 <div className="text-xs font-bold text-text-secondary uppercase tracking-wider flex items-center justify-center font-mono">
 Impact \ Mosca Likelihood
 </div>
 {likelihoods.map((l) => (
 <div
 key={l}
 className="text-xs font-bold text-center text-text-secondary uppercase tracking-wider py-1.5 bg-background/60 rounded-lg border border-border font-mono"
 >
 {l}
 </div>
 ))}
 </div>

 {/* Matrix Rows */}
 {impacts.map((impact) => (
 <div key={impact} className="grid grid-cols-5 gap-3 mb-3">
 {/* Row Header */}
 <div className="text-xs font-bold text-text-secondary uppercase tracking-wider py-4 px-3 bg-background/60 rounded-lg border border-border flex items-center justify-between font-mono">
 <span>{impact}</span>
 <span
 className={`w-2 h-2 rounded-full ${
 impact === 'Critical'
 ? 'bg-critical'
 : impact === 'High'
 ? 'bg-high'
 : impact === 'Medium'
 ? 'bg-medium'
 : 'bg-info'
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
 ? `${cell?.colorClass || 'bg-bg-1 border-border-soft'} cursor-pointer hover:scale-105 hover:shadow-xl`
 : 'bg-background/40 border-border text-text-muted cursor-default'
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
 count > 0 ? 'text-text-brand' : 'text-text-muted'
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
 <h4 className="text-sm font-semibold text-text-brand mb-3 flex items-center gap-2">
 <ShieldAlert className="w-4 h-4 text-high" />
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
 className="p-3.5 rounded-xl border border-border bg-background/60 hover:border-border-soft cursor-pointer transition-all flex items-center justify-between group"
 >
 <div>
 <div className="flex items-center gap-2">
 <span className="text-xs font-bold text-text-brand">
 {cell.impact} Impact / {cell.likelihood}
 </span>
 </div>
 <span className="text-[11px] text-crypto group-hover:underline mt-1 block">
 Click to inspect {cell.count} evidence items
 </span>
 </div>

 <div className="text-xl font-bold px-3 py-1 rounded-lg bg-surface text-text-brand border border-border-soft">
 {cell.count}
 </div>
 </div>
 ))}
 </div>
 </div>
 </div>
 );
};
