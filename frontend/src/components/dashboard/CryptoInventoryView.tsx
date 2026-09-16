import React, { useState, useMemo } from 'react';
import {
  Layers,
  Search,
  Filter,
  FileCode,
  ExternalLink,
  KeyRound,
} from 'lucide-react';
import { CryptoInventoryView as CryptoInventoryData } from '../../types';

interface Props {
  data: CryptoInventoryData;
  onOpenEvidence: (title: string, subtitle: string, evidenceIds: string[]) => void;
}

export const CryptoInventoryView: React.FC<Props> = ({
  data,
  onOpenEvidence,
}) => {
  const [search, setSearch] = useState('');
  const [selectedPrimitive, setSelectedPrimitive] = useState<string>('ALL');

  const filteredComponents = useMemo(() => {
    return data.components.filter((comp) => {
      if (selectedPrimitive !== 'ALL' && comp.primitive !== selectedPrimitive) {
        return false;
      }
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        comp.name.toLowerCase().includes(q) ||
        comp.algorithm.toLowerCase().includes(q) ||
        (comp.location && comp.location.toLowerCase().includes(q)) ||
        comp.id.toLowerCase().includes(q)
      );
    });
  }, [data.components, search, selectedPrimitive]);

  const primitives = useMemo(() => {
    const set = new Set<string>();
    data.components.forEach((c) => {
      if (c.primitive) set.add(c.primitive);
    });
    return Array.from(set);
  }, [data.components]);

  const allCompEvidenceIds = data.components.map((c) => c.finding_id || c.id);

  return (
    <div className="space-y-5">
      {/* Header bar */}
      <div className="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-100">Cryptographic Inventory (CBOM)</h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Complete inventory of cryptographic primitives, key lengths, implementations, and call sites.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              onOpenEvidence(
                'Complete Crypto Inventory Evidence',
                `Aggregated evidence across all ${data.total_components} discovered cryptographic components`,
                allCompEvidenceIds
              )
            }
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-cyan-950/80 border border-cyan-700/60 text-cyan-300 hover:bg-cyan-900/80 transition-colors inline-flex items-center gap-1.5"
          >
            <span>Evidence for All ({data.total_components})</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search algorithms, files, components..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-slate-900/90 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <button
            onClick={() => setSelectedPrimitive('ALL')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              selectedPrimitive === 'ALL'
                ? 'bg-cyan-950 border border-cyan-700 text-cyan-200'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Primitives
          </button>
          {primitives.map((prim) => (
            <button
              key={prim}
              onClick={() => setSelectedPrimitive(prim)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                selectedPrimitive === prim
                  ? 'bg-cyan-950 border border-cyan-700 text-cyan-200'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {prim}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/70 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Component & Algorithm</th>
                <th className="py-3 px-4">Key Size</th>
                <th className="py-3 px-4">Primitive</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Mosca Status</th>
                <th className="py-3 px-4">Source Location</th>
                <th className="py-3 px-4 text-right">Evidence Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredComponents.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-500">
                    No cryptographic components found matching query.
                  </td>
                </tr>
              ) : (
                filteredComponents.map((comp) => {
                  const evId = comp.finding_id || comp.id;
                  return (
                    <tr
                      key={comp.id}
                      className="hover:bg-slate-850/50 transition-colors group"
                    >
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-100 flex items-center gap-1.5">
                          <KeyRound className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>{comp.name}</span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500">{comp.id}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-200">
                        {comp.key_size ? `${comp.key_size} bit` : 'N/A'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-700">
                          {comp.primitive}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() =>
                            onOpenEvidence(
                              `Evidence: ${comp.severity} Severity`,
                              `Component ${comp.name} classified as ${comp.severity}`,
                              [evId]
                            )
                          }
                          className={`px-2 py-0.5 rounded text-[11px] font-semibold border cursor-pointer hover:underline ${
                            comp.severity === 'Critical'
                              ? 'bg-rose-950/80 border-rose-500 text-rose-300'
                              : comp.severity === 'High'
                              ? 'bg-amber-950/80 border-amber-500 text-amber-300'
                              : comp.severity === 'Medium'
                              ? 'bg-yellow-950/80 border-yellow-500 text-yellow-300'
                              : 'bg-sky-950/80 border-sky-500 text-sky-300'
                          }`}
                          title="Click to inspect severity evidence"
                        >
                          {comp.severity}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() =>
                            onOpenEvidence(
                              `Evidence: Mosca ${comp.mosca_status}`,
                              `Quantum threat assessment for ${comp.algorithm}`,
                              [evId]
                            )
                          }
                          className={`px-2 py-0.5 rounded text-[11px] font-medium border cursor-pointer hover:underline ${
                            comp.mosca_status === 'CRITICAL_URGENT'
                              ? 'bg-red-950/80 border-red-500 text-red-300'
                              : comp.mosca_status === 'AT_RISK'
                              ? 'bg-orange-950/80 border-orange-500 text-orange-300'
                              : comp.mosca_status === 'WATCH'
                              ? 'bg-yellow-950/80 border-yellow-500 text-yellow-300'
                              : 'bg-emerald-950/80 border-emerald-500 text-emerald-300'
                          }`}
                          title="Click to inspect Mosca calculation evidence"
                        >
                          {comp.mosca_status}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-400">
                        {comp.location ? (
                          <div className="flex items-center gap-1.5 truncate max-w-xs">
                            <FileCode className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span className="truncate">{comp.location}</span>
                            {comp.line_number && (
                              <span className="text-cyan-400">:{comp.line_number}</span>
                            )}
                          </div>
                        ) : (
                          'Network / Dynamic'
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() =>
                            onOpenEvidence(
                              `Evidence: ${comp.name}`,
                              `Direct AST and finding evidence for ${comp.id}`,
                              [evId]
                            )
                          }
                          className="px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 text-xs inline-flex items-center gap-1 transition-colors"
                        >
                          <span>Evidence</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
