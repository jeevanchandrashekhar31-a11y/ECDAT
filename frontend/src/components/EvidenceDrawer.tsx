import React, { useState, useMemo } from 'react';
import {
  X,
  FileCode,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  AlertOctagon,
  Search,
  Filter,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EvidenceFinding, SeverityLevel, MoscaStatus } from '../types';

interface EvidenceDrawerProps {
  isOpen: boolean;
  title: string;
  subtitle?: string;
  evidenceIds: string[];
  evidenceLookup: Record<string, EvidenceFinding>;
  onClose: () => void;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({
  isOpen,
  title,
  subtitle,
  evidenceIds,
  evidenceLookup,
  onClose,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [allCopied, setAllCopied] = useState(false);

  // Map IDs to finding objects
  const items: EvidenceFinding[] = useMemo(() => {
    return evidenceIds
      .map((id) => evidenceLookup[id])
      .filter((item): item is EvidenceFinding => Boolean(item));
  }, [evidenceIds, evidenceLookup]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (severityFilter !== 'ALL' && item.severity !== severityFilter) {
        return false;
      }
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        item.id.toLowerCase().includes(term) ||
        item.algorithm.toLowerCase().includes(term) ||
        (item.location && item.location.toLowerCase().includes(term)) ||
        (item.evidence_context && item.evidence_context.toLowerCase().includes(term)) ||
        (item.quantum_relevance && item.quantum_relevance.toLowerCase().includes(term))
      );
    });
  }, [items, searchTerm, severityFilter]);

  const handleCopySnippet = (id: string, text?: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAllJson = () => {
    navigator.clipboard.writeText(JSON.stringify(items, null, 2));
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  if (!isOpen) return null;

  const getSeverityBadge = (sev: SeverityLevel) => {
    switch (sev) {
      case 'Critical':
        return 'bg-rose-950/60 border-rose-500/50 text-rose-300';
      case 'High':
        return 'bg-amber-950/60 border-amber-500/50 text-amber-300';
      case 'Medium':
        return 'bg-yellow-950/60 border-yellow-500/50 text-yellow-300';
      case 'Low':
        return 'bg-sky-950/60 border-sky-500/50 text-sky-300';
      default:
        return 'bg-surfaceHover border-borderMid text-slate-300';
    }
  };

  const getMoscaBadge = (status: MoscaStatus) => {
    switch (status) {
      case 'CRITICAL_URGENT':
        return 'bg-red-950/70 border-red-500 text-red-300';
      case 'AT_RISK':
        return 'bg-orange-950/70 border-orange-500 text-orange-300';
      case 'WATCH':
        return 'bg-yellow-950/70 border-yellow-500 text-yellow-300';
      case 'SAFE':
        return 'bg-emerald-950/70 border-emerald-500 text-emerald-300';
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over panel */}
      <div className="relative w-full max-w-2xl bg-surface/95 border-l border-border shadow-2xl shadow-cyan-950/30 flex flex-col h-full z-10">
        {/* Header */}
        <div className="p-5 border-b border-border bg-background/80 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-950/80 border border-cyan-800/60 text-primary/80">
                {items.length} {items.length === 1 ? 'Finding' : 'Findings'} Linked
              </span>
            </div>
            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyAllJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surfaceHover/80 hover:bg-surfaceMid/80 text-slate-200 border border-borderMid transition-colors"
              title="Copy all evidence items as JSON"
            >
              {allCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              {allCopied ? 'Copied JSON' : 'Export JSON'}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-surfaceHover transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="px-5 py-3 border-b border-border/80 bg-surface/50 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search file, algorithm, line..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-background/80 border border-border text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                  severityFilter === sev
                    ? 'bg-cyan-950 border border-cyan-700 text-cyan-200'
                    : 'bg-slate-850 border border-border text-slate-400 hover:text-slate-200'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {/* Findings List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {filteredItems.length === 0 ? (
            <div className="text-center py-16 px-4">
              <AlertOctagon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-slate-300">No evidence items match filter</p>
              <p className="text-xs text-slate-500 mt-1">Try broadening your search query or severity selector.</p>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <div
                key={item.id || index}
                className="bg-background/80 border border-border/90 rounded-xl p-4 transition-all hover:border-borderMid/90"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="flex items-center flex-wrap gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {item.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getSeverityBadge(
                        item.severity
                      )}`}
                    >
                      {item.severity}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-medium border ${getMoscaBadge(
                        item.mosca_status
                      )}`}
                    >
                      Mosca: {item.mosca_status}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[11px] bg-surfaceHover/80 border border-borderMid/80 text-slate-300">
                      {item.category || 'algorithm'}
                    </span>
                  </div>

                  <Link
                    to={`/findings?search=${item.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80"
                    title="Open full finding details in separate tab"
                  >
                    <span>Inspect</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>

                {/* Algorithm & threat horizon specs */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2 mb-2 text-xs border-y border-border/70">
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-mono">Algorithm</span>
                    <span className="text-slate-200 font-medium">
                      {item.algorithm} {item.key_size !== undefined && item.key_size !== null ? `(${item.key_size} bit)` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-mono">Classical Risk</span>
                    <span className="text-slate-300">{item.classical_risk || 'Standard'}</span>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <span className="text-slate-500 block text-[10px] uppercase font-mono">Quantum Impact</span>
                    <span className="text-amber-300 font-medium">{item.quantum_relevance || 'None'}</span>
                  </div>
                </div>

                {/* Exact Code Location */}
                <div className="relative group flex items-center gap-2 mb-2 text-xs font-mono text-slate-400 bg-surface/80 px-2.5 py-1.5 rounded-lg border border-border">
                  <FileCode className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate cursor-help">{item.location || 'Endpoint / Session'}</span>
                  {item.line_number ? (
                    <span className="text-primary/80 font-semibold shrink-0">
                      :line {item.line_number}
                    </span>
                  ) : null}
                  {/* Hover Tooltip / Dropdown */}
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-[100]">
                    <div className="bg-slate-900 border border-slate-700 p-2.5 rounded shadow-xl min-w-[250px] max-w-[400px] break-all whitespace-normal text-slate-200 text-xs">
                      {item.location || 'Endpoint / Session'}
                      {item.line_number ? `:${item.line_number}` : ''}
                    </div>
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-900 border-b border-r border-slate-700 rotate-45"></div>
                  </div>
                </div>

                {/* Evidence Code Snippet / AST context */}
                {item.evidence_context && (
                  <div className="relative group">
                    <pre className="text-xs font-mono text-cyan-200 bg-background p-3 rounded-lg border border-slate-850 overflow-x-auto selection:bg-cyan-900">
                      <code>{item.evidence_context}</code>
                    </pre>
                    <button
                      onClick={() => handleCopySnippet(item.id, item.evidence_context)}
                      className="absolute right-2 top-2 p-1 rounded bg-surfaceHover/90 text-slate-400 hover:text-slate-200 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Copy snippet"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-background/80 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing {filteredItems.length} of {items.length} evidence items
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg font-medium bg-surfaceHover hover:bg-surfaceMid text-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
