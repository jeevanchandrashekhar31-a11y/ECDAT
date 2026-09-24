import React, { useState, useMemo } from 'react';
import {
 Binary,
 Search,
 ExternalLink,
 ArrowRight,
} from 'lucide-react';
import { AlgorithmsView as AlgorithmsData } from '../../types';

interface Props {
 data: AlgorithmsData;
 onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const AlgorithmsView: React.FC<Props> = ({
 data,
 onOpenEvidence,
}) => {
 const [search, setSearch] = useState('');

 const filteredAlgos = useMemo(() => {
 return data.algorithms.filter((a) => {
 if (!search) return true;
 const q = search.toLowerCase();
 return (
 a.name.toLowerCase().includes(q) ||
 a.primitive.toLowerCase().includes(q) ||
 a.target_replacement.toLowerCase().includes(q)
 );
 });
 }, [data.algorithms, search]);

 return (
 <div className="space-y-6">
 {/* Header */}
 <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
 <div>
 <div className="flex items-center gap-2">
 <Binary className="w-5 h-5 text-crypto" />
 <h3 className="text-lg font-bold text-text-brand">Cryptographic Algorithm Catalog</h3>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Usage frequencies, primitive classifications, Shor/Grover vulnerability horizons, and NIST target migrations.
 </p>
 </div>

 <span className="px-3 py-1 rounded-full text-xs font-semibold bg-surface text-text-secondary border border-border-soft">
 {data.total_distinct_algorithms} Distinct Algorithms
 </span>
 </div>

 {/* Filter toolbar */}
 <div className="relative max-w-md">
 <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-secondary" />
 <input
 type="text"
 placeholder="Filter algorithms, primitives, migration targets..."
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-bg-1/90 border border-border text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 {/* Algorithms Cards */}
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {filteredAlgos.map((algo) => {
 const evidenceIds = algo.evidence_occurrences.map((o) => o.finding_id);
 const isQuantumThreat =
 algo.quantum_relevance?.toLowerCase().includes('shor') ||
 /\brsa\b/i.test(algo.name) ||
 /\b(ec|ecc|ecdsa|ecdh)\b/i.test(algo.name);

 return (
 <div
 key={algo.name}
 className="glass-card p-5 flex flex-col justify-between hover:border-border-soft transition-all group min-w-0"
 >
 <div>
 {/* Header row */}
 <div className="flex items-start justify-between mb-2">
 <div className="min-w-0 pr-2">
 <h4 className="font-bold text-text-brand text-base group-hover:text-crypto transition-colors truncate" title={algo.name}>
 {algo.name}
 </h4>
 <span className="text-[11px] font-mono text-text-secondary block truncate" title={algo.primitive}>{algo.primitive}</span>
 </div>

 <button
 onClick={() =>
 onOpenEvidence(
 `Algorithm Evidence: ${algo.name}`,
 `All ${algo.count} occurrences of ${algo.name} in codebase and network`,
 evidenceIds
 )
 }
 className="px-2.5 py-1 rounded-lg text-xs font-bold bg-surface-2 border border-border-soft text-crypto hover:bg-surface-2 transition-colors cursor-pointer"
 title="Click to view occurrences"
 >
 {algo.count} {algo.count === 1 ? 'call' : 'calls'}
 </button>
 </div>

 {/* Risk tags */}
 <div className="space-y-1.5 my-3 text-xs">
 <div className="flex items-center justify-between bg-background/40 p-2 rounded-lg border border-border">
 <span className="text-text-secondary font-mono text-[11px]">Classical Risk:</span>
 <span
 className={`font-semibold text-[11px] ${
 algo.classical_risk === 'Critical'
 ? 'text-critical'
 : algo.classical_risk === 'High'
 ? 'text-high'
 : 'text-text-secondary'
 }`}
 >
 {algo.classical_risk || 'Standard'}
 </span>
 </div>

 <div className="flex items-center justify-between bg-background/40 p-2 rounded-lg border border-border">
 <span className="text-text-secondary font-mono text-[11px]">Quantum Risk:</span>
 <span
 className={`font-semibold text-[11px] truncate max-w-[170px] ${
 isQuantumThreat ? 'text-high' : 'text-success'
 }`}
 >
 {algo.quantum_relevance || 'Safe'}
 </span>
 </div>
 </div>

 {/* Target Replacement */}
 <div className="p-2.5 rounded-lg bg-background/70 border border-border text-xs mb-3">
 <span className="text-[10px] text-text-muted block uppercase font-mono mb-0.5">
 NIST Target Migration
 </span>
 <div className="flex items-center gap-1.5 text-specialized font-mono font-medium">
 <ArrowRight className="w-3.5 h-3.5 text-specialized shrink-0" />
 <span className="truncate">{algo.target_replacement}</span>
 </div>
 </div>
 </div>

 {/* Footer Evidence Link */}
 <div className="pt-3 border-t border-border flex items-center justify-between">
 <span className="text-[11px] text-text-secondary font-mono">
 {algo.evidence_occurrences.length} call sites
 </span>

 <button
 onClick={() =>
 onOpenEvidence(
 `Evidence: ${algo.name}`,
 `Occurrences of ${algo.name} across static and runtime scan`,
 evidenceIds
 )
 }
 className="text-xs text-crypto hover:text-crypto font-medium inline-flex items-center gap-1"
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
 );
};
