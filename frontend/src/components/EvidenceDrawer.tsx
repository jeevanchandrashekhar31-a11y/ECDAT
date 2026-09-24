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
 return 'bg-surface-2 border-critical text-critical';
 case 'High':
 return 'bg-surface-2 border-high text-high';
 case 'Medium':
 return 'bg-surface-2 border-border text-medium';
 case 'Low':
 return 'bg-surface-2 border-border text-info';
 default:
 return 'bg-surface border-border-soft text-text-secondary';
 }
 };

 const getMoscaBadge = (status: MoscaStatus) => {
 switch (status) {
 case 'CRITICAL_URGENT':
 return 'bg-surface-2 border-critical text-critical';
 case 'AT_RISK':
 return 'bg-surface-2 border-high text-high';
 case 'WATCH':
 return 'bg-surface-2 border-medium text-medium';
 case 'SAFE':
 return 'bg-surface-2 border-success text-success';
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
 <div className="relative w-full max-w-2xl bg-bg-1/95 border-l border-border shadow-md flex flex-col h-full z-10">
 {/* Header */}
 <div className="p-5 border-b border-border bg-background/80 flex items-start justify-between">
 <div>
 <div className="flex items-center gap-2">
 <ShieldAlert className="w-5 h-5 text-crypto" />
 <h2 className="text-lg font-semibold text-text-brand">{title}</h2>
 <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-surface-2 border border-border-soft text-crypto">
 {items.length} {items.length === 1 ? 'Finding' : 'Findings'} Linked
 </span>
 </div>
 {subtitle && <p className="text-xs text-text-secondary mt-1">{subtitle}</p>}
 </div>

 <div className="flex items-center gap-2">
 <button
 onClick={handleCopyAllJson}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface hover:bg-surface-2/80 text-text-brand border border-border-soft transition-colors"
 title="Copy all evidence items as JSON"
 >
 {allCopied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5 text-text-secondary" />}
 {allCopied ? 'Copied JSON' : 'Export JSON'}
 </button>
 <button
 onClick={onClose}
 className="p-1.5 rounded-lg text-text-secondary hover:text-text-brand hover:bg-surface transition-colors"
 >
 <X className="w-5 h-5" />
 </button>
 </div>
 </div>

 {/* Filter Bar */}
 <div className="px-5 py-3 border-b border-border bg-bg-1/50 flex flex-wrap items-center gap-3">
 <div className="relative flex-1 min-w-[180px]">
 <Search className="w-4 h-4 absolute left-3 top-2.5 text-text-secondary" />
 <input
 type="text"
 placeholder="Search file, algorithm, line..."
 value={searchTerm}
 onChange={(e) => setSearchTerm(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-background/80 border border-border text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 <div className="flex items-center gap-1.5">
 <Filter className="w-3.5 h-3.5 text-text-secondary" />
 {['ALL', 'Critical', 'High', 'Medium', 'Low'].map((sev) => (
 <button
 key={sev}
 onClick={() => setSeverityFilter(sev)}
 className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
 severityFilter === sev
 ? 'bg-surface-2 border border-pqc text-crypto'
 : 'bg-surface-2 border border-border text-text-secondary hover:text-text-brand'
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
 <AlertOctagon className="w-10 h-10 text-text-muted mx-auto mb-3" />
 <p className="text-sm font-medium text-text-secondary">No evidence items match filter</p>
 <p className="text-xs text-text-muted mt-1">Try broadening your search query or severity selector.</p>
 </div>
 ) : (
 filteredItems.map((item, index) => (
 <div
 key={item.id || index}
 className="bg-background/80 border border-border rounded-xl p-4 transition-all hover:border-border-soft/90"
 >
 {/* Header row */}
 <div className="flex items-start justify-between gap-3 mb-2.5">
 <div className="flex items-center flex-wrap gap-2">
 <span className="font-mono text-xs font-semibold text-crypto">
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
 <span className="px-2 py-0.5 rounded text-[11px] bg-surface border border-border-soft/80 text-text-secondary">
 {item.category || 'algorithm'}
 </span>
 </div>

 <Link
 to={`/findings?search=${item.id}`}
 target="_blank"
 className="inline-flex items-center gap-1 text-[11px] text-crypto hover:text-crypto"
 title="Open full finding details in separate tab"
 >
 <span>Inspect</span>
 <ExternalLink className="w-3 h-3" />
 </Link>
 </div>

 {/* Algorithm & threat horizon specs */}
 <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2 mb-2 text-xs border-y border-border">
 <div>
 <span className="text-text-muted block text-[10px] uppercase font-mono">Algorithm</span>
 <span className="text-text-brand font-medium">
 {item.algorithm} {item.key_size !== undefined && item.key_size !== null ? `(${item.key_size} bit)` : ''}
 </span>
 </div>
 <div>
 <span className="text-text-muted block text-[10px] uppercase font-mono">Classical Risk</span>
 <span className="text-text-secondary">{item.classical_risk || 'Standard'}</span>
 </div>
 <div className="col-span-2 sm:col-span-1">
 <span className="text-text-muted block text-[10px] uppercase font-mono">Quantum Impact</span>
 <span className="text-high font-medium">{item.quantum_relevance || 'None'}</span>
 </div>
 </div>

 {/* Exact Code Location */}
 <div className="flex items-center gap-2 mb-2 text-xs font-mono text-text-secondary bg-bg-1/80 px-2.5 py-1.5 rounded-lg border border-border">
 <FileCode className="w-3.5 h-3.5 text-crypto shrink-0" />
 <span className="truncate">{item.location || 'Endpoint / Session'}</span>
 {item.line_number ? (
 <span className="text-crypto font-semibold shrink-0">
 :line {item.line_number}
 </span>
 ) : null}
 </div>

 {/* Evidence Code Snippet / AST context */}
 {item.evidence_context && (
 <div className="relative group">
 <pre className="text-xs font-mono text-crypto bg-background p-3 rounded-lg border border-border overflow-x-auto selection:bg-surface-2">
 <code>{item.evidence_context}</code>
 </pre>
 <button
 onClick={() => handleCopySnippet(item.id, item.evidence_context)}
 className="absolute right-2 top-2 p-1 rounded bg-surface text-text-secondary hover:text-text-brand opacity-0 group-hover:opacity-100 transition-opacity"
 title="Copy snippet"
 >
 {copiedId === item.id ? (
 <Check className="w-3.5 h-3.5 text-success" />
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
 <div className="p-4 border-t border-border bg-background/80 flex items-center justify-between text-xs text-text-secondary">
 <span>
 Showing {filteredItems.length} of {items.length} evidence items
 </span>
 <button
 onClick={onClose}
 className="px-4 py-1.5 rounded-lg font-medium bg-surface hover:bg-surface-2 text-text-brand transition-colors"
 >
 Close
 </button>
 </div>
 </div>
 </div>
 );
};
