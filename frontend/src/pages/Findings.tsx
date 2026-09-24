import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
 Shield,
 Search,
 Filter,
 Wrench,
 Loader2,
 RefreshCw,
 CheckCircle,
 XCircle,
 ChevronRight,
 Code2,
 Cpu,
 Clock,
 Sparkles,
 Play,
 X,
} from 'lucide-react';
import { api } from '../api/client';
import { FindingItem, SeverityLevel, MoscaStatus } from '../types';

interface OutletContextType {
 selectedScanId?: string;
 onUploadSuccess?: (newScanId: string) => void;
}

export const Findings: React.FC = () => {
 const { selectedScanId } = useOutletContext<OutletContextType>() || {};
 const navigate = useNavigate();

 // State
 const [findings, setFindings] = useState<FindingItem[]>([]);
 const [totalFindings, setTotalFindings] = useState<number>(0);
 const [loading, setLoading] = useState<boolean>(true);
 const [errorDetails, setErrorDetails] = useState<{
 status?: number;
 code?: string;
 message: string;
 details?: unknown;
 } | null>(null);

 // Filters
 const [severityFilter, setSeverityFilter] = useState<string>('ALL');
 const [searchQuery, setSearchQuery] = useState<string>('');
 const [showFilters, setShowFilters] = useState<boolean>(false);

 // Active selected finding drawer
 const [selectedFinding, setSelectedFinding] = useState<FindingItem | null>(null);
 const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'cbom' | 'pqc'>('overview');

 // Triggering scan state
 const [triggeringScan, setTriggeringScan] = useState<boolean>(false);
 const [scanMessage, setScanMessage] = useState<string | null>(null);

 // Review finding state
 const [isReviewing, setIsReviewing] = useState(false);
 const [showDismissModal, setShowDismissModal] = useState(false);
 const [dismissReason, setDismissReason] = useState('');
 const [isRerunning, setIsRerunning] = useState(false);

 const fetchFindings = useCallback(async () => {
 setLoading(true);
 setErrorDetails(null);

 try {
 const activeScan = selectedScanId;
 const res = await api.getFindings({
 scanId: activeScan,
 severity: severityFilter !== 'ALL' ? severityFilter : undefined,
 pageSize: 50,
 });
 setFindings(res.findings || []);
 setTotalFindings(res.total || 0);
 } catch (err: unknown) {
 const errorObj = err as { status?: number; data?: Record<string, unknown>; message?: string };
 setErrorDetails({
 status: errorObj.status,
 code: (errorObj.data?.code as string) || (errorObj.data?.error as string) || 'FETCH_ERROR',
 message: (errorObj.data?.message as string) || errorObj.message || 'Failed to fetch cryptographic findings.',
 details: errorObj.data,
 });
 } finally {
 setLoading(false);
 }
 }, [selectedScanId, severityFilter]);

 useEffect(() => {
 fetchFindings();
 }, [fetchFindings]);

 // Handle start demo scan from empty state
 const handleStartDemoScan = async () => {
 setTriggeringScan(true);
 setScanMessage(null);
 try {
 const seedRes = await api.seedEvaluationTenant();
 setScanMessage(`Scan initiated successfully (${seedRes.scan_id}). Reloading findings...`);
 await fetchFindings();
 } catch (err: unknown) {
 const e = err as Error;
 setScanMessage(`Failed to trigger scan: ${e.message}`);
 } finally {
 setTriggeringScan(false);
 }
 };

 const handleReview = async (action: 'CONFIRM' | 'DISMISS') => {
 if (!selectedFinding) return;
 if (action === 'DISMISS' && !dismissReason.trim()) {
 alert('Please provide a reason for dismissing.');
 return;
 }
 setIsReviewing(true);
 try {
 await api.reviewFinding(selectedFinding.id, action, dismissReason);
 setScanMessage(`Finding ${selectedFinding.id} successfully ${action === 'CONFIRM' ? 'confirmed' : 'dismissed'}.`);
 setShowDismissModal(false);
 setDismissReason('');
 setSelectedFinding(null);
 await fetchFindings();
 } catch (err: unknown) {
 const e = err as Error;
 alert(`Failed to review finding: ${e.message}`);
 } finally {
 setIsReviewing(false);
 }
 };

 const handleRerunLive = async () => {
 if (!selectedFinding) return;
 setIsRerunning(true);
 setScanMessage(`Re-running live analysis for ${selectedFinding.id}...`);
 try {
 await api.rerunLiveAnalysis(selectedFinding.id);
 setScanMessage(`Live analysis complete. Finding updated.`);
 
 // Update selectedFinding local state and refetch
 const updatedFinding = { ...selectedFinding, cached: false };
 setSelectedFinding(updatedFinding);
 await fetchFindings();
 } catch (err: unknown) {
 const e = err as Error;
 alert(`Failed to re-run analysis: ${e.message}`);
 setScanMessage(null);
 } finally {
 setIsRerunning(false);
 }
 };

 // Filter client-side search query
 const filteredFindings = findings.filter((f) => {
 if (!searchQuery.trim()) return true;
 const q = searchQuery.toLowerCase();
 return (
 (f.algorithm && f.algorithm.toLowerCase().includes(q)) ||
 (f.category && f.category.toLowerCase().includes(q)) ||
 (f.location && f.location.toLowerCase().includes(q)) ||
 (f.explanation && f.explanation.toLowerCase().includes(q)) ||
 (f.id && f.id.toLowerCase().includes(q))
 );
 });

 const getSeverityBadgeClass = (severity: SeverityLevel | string) => {
 const s = String(severity).toLowerCase();
 switch (s) {
 case 'critical':
 return 'bg-critical/20 text-critical border-critical';
 case 'high':
 return 'bg-high/20 text-high border-high';
 case 'medium':
 return 'bg-medium text-medium border-border';
 case 'low':
 return 'bg-pqc/20 text-crypto border-pqc/40';
 default:
 return 'bg-surface-3 text-text-secondary border-border-soft';
 }
 };

 const getMoscaBadgeClass = (status: MoscaStatus | string) => {
 const s = String(status).toUpperCase();
 switch (s) {
 case 'CRITICAL_URGENT':
 return 'bg-surface-2 text-critical border-critical animate-pulse';
 case 'AT_RISK':
 return 'bg-surface-2 text-high border-high';
 case 'WATCH':
 return 'bg-surface-2 text-medium border-medium';
 case 'SAFE':
 return 'bg-surface-2 text-success border-success';
 default:
 return 'bg-bg-1 text-text-secondary border-border-soft';
 }
 };

 return (
 <div className="space-y-6">
 {/* Header Banner */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
 <div>
 <div className="flex items-center gap-2 mb-1">
 <h1 className="text-xl font-extrabold text-text-brand tracking-tight flex items-center gap-2">
 <Shield className="text-crypto" size={22} />
 <span>Cryptographic Findings</span>
 </h1>
 <span className="text-xs px-2 py-0.5 rounded-full bg-pqc/10 text-crypto border border-pqc/30 font-mono">
 {totalFindings} Found
 </span>
 </div>
 <p className="text-xs text-text-secondary">
 Discovered cryptographic primitives, key sizes, vulnerabilities, and post-quantum readiness assessments.
 </p>
 </div>

 <div className="flex items-center gap-2.5">
 <button
 onClick={() => fetchFindings()}
 disabled={loading}
 className="p-2 rounded-xl bg-bg-1 hover:bg-surface text-text-secondary border border-border transition-colors"
 title="Refresh findings"
 >
 <RefreshCw size={15} className={loading ? 'animate-spin text-crypto' : ''} />
 </button>
 <button
 onClick={handleStartDemoScan}
 disabled={triggeringScan}
 className="px-3.5 py-2 rounded-xl bg-brand hover:bg-brand hover: text-text-muted font-bold text-xs shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
 >
 {triggeringScan ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
 <span>{triggeringScan ? 'Running Scan...' : 'Start / Seed Scan'}</span>
 </button>
 </div>
 </div>

 {scanMessage && (
 <div className="p-3 rounded-xl bg-surface-2 border border-pqc/30 text-xs text-crypto flex items-center gap-2">
 <CheckCircle size={15} className="text-crypto shrink-0" />
 <span>{scanMessage}</span>
 </div>
 )}

 {/* Filter Bar */}
 <div className="glass-card p-4 rounded-xl border border-border bg-bg-1/50 space-y-3">
 <div className="flex items-center justify-between text-xs font-semibold text-text-secondary">
 <button
 onClick={() => setShowFilters(!showFilters)}
 className="flex items-center gap-2 hover:text-crypto transition-colors"
 >
 <Filter size={14} className={showFilters ? "text-crypto" : "text-text-secondary"} />
 <span>{showFilters ? "Hide Filters & Search" : "Show Filters & Search"}</span>
 </button>
 </div>

 {showFilters && (
 <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border">
 {/* Search Box */}
 <div className="relative flex-1 min-w-[200px]">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
 <input
 type="text"
 placeholder="Search algorithm, explanation..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-background border border-border text-xs text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 {/* Severity Filter */}
 <div className="flex items-center gap-1.5 text-xs text-text-secondary">
 <Filter size={13} className="text-crypto" />
 <span>Severity:</span>
 <select
 value={severityFilter}
 onChange={(e) => setSeverityFilter(e.target.value)}
 className="bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-brand focus:outline-none focus:border-pqc"
 >
 <option value="ALL">All Severities</option>
 <option value="critical">Critical</option>
 <option value="high">High</option>
 <option value="medium">Medium</option>
 <option value="low">Low</option>
 <option value="informational">Informational</option>
 </select>
 </div>
 </div>
 )}
 </div>

 {/* REAL LOADING STATE */}
 {loading && findings.length === 0 && (
 <div className="glass-card p-12 rounded-2xl border border-border bg-bg-1/60 flex flex-col items-center justify-center text-center">
 <Loader2 size={32} className="text-crypto animate-spin mb-3" />
 <h3 className="text-sm font-bold text-text-brand mb-1">Loading Findings</h3>
 <p className="text-xs text-text-secondary max-w-sm">
 Querying authoritative backend findings and verifying cryptographic risk classification...
 </p>
 </div>
 )}

 {/* REAL ERROR STATE (Backend Error Shape Display) */}
 {!loading && errorDetails && (
 <div className="p-6 rounded-2xl border border-critical bg-surface-2 text-critical space-y-3">
 <div className="flex items-center gap-2 text-critical">
 <XCircle size={20} />
 <h3 className="text-sm font-bold">Backend Findings Query Error ({errorDetails.status || '500'})</h3>
 </div>
 <p className="text-xs text-critical font-medium">{errorDetails.message}</p>
 {errorDetails.code && (
 <div className="text-2xs font-mono bg-background p-2.5 rounded-lg border border-critical text-critical">
 Code: {errorDetails.code}
 </div>
 )}
 <button
 onClick={() => fetchFindings()}
 className="px-3 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-2 text-text-brand text-xs font-semibold"
 >
 Retry Query
 </button>
 </div>
 )}

 {/* REAL EMPTY STATE (Genuinely empty tenant before scan) */}
 {!loading && !errorDetails && filteredFindings.length === 0 && (
 <div className="glass-card p-12 rounded-2xl border border-border bg-bg-1/60 text-center space-y-4">
 <div className="w-12 h-12 rounded-2xl bg-pqc/10 text-crypto border border-pqc/20 flex items-center justify-center mx-auto">
 <Shield size={24} />
 </div>
 <div className="max-w-md mx-auto">
 <h3 className="text-base font-bold text-text-brand mb-1">No Cryptographic Findings Detected</h3>
 <p className="text-xs text-text-secondary leading-relaxed">
 This Evaluation Environment has not executed any cryptographic scans yet, or no findings match the selected filter.
 Trigger a scan below to discover cryptographic primitives, identify quantum vulnerabilities, and populate findings.
 </p>
 </div>
 <div className="pt-2 flex justify-center gap-3">
 <button
 onClick={handleStartDemoScan}
 disabled={triggeringScan}
 className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand text-text-muted font-bold text-xs flex items-center gap-2"
 >
 {triggeringScan ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
 <span>{triggeringScan ? 'Triggering Scan...' : 'Start Evaluation Scan'}</span>
 </button>
 </div>
 </div>
 )}

 {/* FINDINGS TABLE */}
 {!loading && !errorDetails && filteredFindings.length > 0 && (
 <div className="glass-card rounded-2xl border border-border bg-bg-1/60 overflow-hidden shadow-xl">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs border-collapse">
 <thead>
 <tr className="bg-background/80 border-b border-border text-text-secondary text-2xs uppercase tracking-wider font-semibold">
 <th className="py-3 px-4">Finding ID</th>
 <th className="py-3 px-4">Severity</th>
 <th className="py-3 px-4">Algorithm &amp; Key Size</th>
 <th className="py-3 px-4">Policy Profile</th>
 <th className="py-3 px-4">Assessment Status</th>
 <th className="py-3 px-4 text-right">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {filteredFindings.map((finding) => (
 <tr
 key={finding.id}
 onClick={() => setSelectedFinding(finding)}
 className="hover:bg-surface cursor-pointer transition-colors group"
 >
 <td className="py-3 px-4 font-mono text-text-secondary text-[11px] truncate max-w-[120px]" title={finding.id}>
 {finding.id}
 </td>
 <td className="py-3 px-4">
 <span className={`inline-flex px-2 py-0.5 rounded-full text-2xs font-bold border ${getSeverityBadgeClass(finding.severity)}`}>
 {finding.severity || 'Medium'}
 </span>
 </td>
 <td className="py-3 px-4">
 <div className="flex items-center gap-1.5 font-mono font-bold text-text-brand">
 <Cpu size={14} className="text-crypto shrink-0" />
 <span>{finding.algorithm}</span>
 {finding.key_size && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-crypto border border-border-soft">
 {finding.key_size}b
 </span>
 )}
 </div>
 </td>
 <td className="py-3 px-4 text-text-secondary font-medium">
 {finding.policy_profile || 'Default CNSA'}
 </td>
 <td className="py-3 px-4">
 <div className="flex flex-col gap-1">
 <span className={`inline-flex px-2 py-0.5 rounded text-2xs font-mono font-bold border w-max ${getMoscaBadgeClass(finding.mosca_status)}`}>
 {finding.mosca_status || 'SAFE'}
 </span>
 {finding.status === 'LLM_FLAGGED_UNVERIFIED' && (
 <span className="inline-flex px-1.5 py-0.5 rounded bg-surface-2 text-specialized border border-specialized text-[9px] uppercase font-bold w-max" title="AI-flagged, pending human review">
 AI Unverified
 </span>
 )}
 {finding.status === 'CONFIRMED' && finding.detection_method === 'semantic_llm' && (
 <span className="inline-flex px-1.5 py-0.5 rounded bg-surface-2 text-success border border-success text-[9px] uppercase font-bold w-max" title="AI-flagged, Confirmed">
 AI Confirmed
 </span>
 )}
 </div>
 </td>
 <td className="py-3 px-4 text-right">
 <button
 onClick={(e) => {
 e.stopPropagation();
 setSelectedFinding(finding);
 }}
 className="inline-flex items-center gap-1 text-2xs text-crypto hover:text-crypto font-semibold"
 >
 <span>Details</span>
 <ChevronRight size={13} />
 </button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 )}

 {/* DETAIL DRAWER / MODAL: CBOM & PQC ASSESSMENT */}
 {selectedFinding && (
 <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
 <div className="w-full max-w-2xl bg-bg-1 border-l border-border h-full overflow-y-auto p-6 flex flex-col shadow-md">
 {/* Header */}
 <div className="flex items-start justify-between pb-4 mb-4 border-b border-border">
 <div>
 <div className="flex items-center gap-2 mb-1">
 <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border ${getSeverityBadgeClass(selectedFinding.severity)}`}>
 {selectedFinding.severity}
 </span>
 <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold border ${getMoscaBadgeClass(selectedFinding.mosca_status)}`}>
 {selectedFinding.mosca_status}
 </span>
 </div>
 <h2 className="text-lg font-bold text-text-brand font-mono flex items-center gap-2">
 <Cpu size={18} className="text-crypto" />
 <span>{selectedFinding.algorithm}</span>
 </h2>
 <p className="text-xs text-text-secondary mb-1">Finding ID: <code className="text-crypto font-mono">{selectedFinding.id}</code></p>
 {selectedFinding.cached && (
 <div className="flex items-center gap-2 mt-2 bg-surface-2 border border-high text-high text-xs py-1.5 px-3 rounded-lg w-max">
 <span className="font-semibold text-[11px]">Result from cached analysis</span>
 <button 
 onClick={handleRerunLive}
 disabled={isRerunning}
 className="ml-2 px-2 py-0.5 rounded bg-high/20 hover:bg-high/40 border border-high font-bold transition-colors flex items-center gap-1 disabled:opacity-50"
 >
 {isRerunning ? (
 <>
 <Loader2 size={12} className="animate-spin" />
 <span>Running...</span>
 </>
 ) : (
 <span>Re-run live</span>
 )}
 </button>
 </div>
 )}
 </div>

 <button
 onClick={() => setSelectedFinding(null)}
 className="p-1.5 rounded-lg text-text-secondary hover:text-text-brand hover:bg-surface"
 >
 <X size={18} />
 </button>
 </div>

 {/* Navigation Tabs */}
 <div className="flex border-b border-border mb-6 text-xs font-semibold">
 <button
 onClick={() => setActiveDetailTab('overview')}
 className={`pb-2.5 px-4 transition-colors border-b-2 ${
 activeDetailTab === 'overview'
 ? 'border-pqc text-crypto'
 : 'border-transparent text-text-secondary hover:text-text-brand'
 }`}
 >
 Risk Overview
 </button>
 <button
 onClick={() => setActiveDetailTab('cbom')}
 className={`pb-2.5 px-4 transition-colors border-b-2 flex items-center gap-1.5 ${
 activeDetailTab === 'cbom'
 ? 'border-pqc text-crypto'
 : 'border-transparent text-text-secondary hover:text-text-brand'
 }`}
 >
 <Code2 size={13} />
 <span>CBOM Component View</span>
 </button>
 <button
 onClick={() => setActiveDetailTab('pqc')}
 className={`pb-2.5 px-4 transition-colors border-b-2 flex items-center gap-1.5 ${
 activeDetailTab === 'pqc'
 ? 'border-pqc text-crypto'
 : 'border-transparent text-text-secondary hover:text-text-brand'
 }`}
 >
 <Sparkles size={13} />
 <span>PQC Assessment Detail</span>
 </button>
 </div>

 {/* TAB 1: OVERVIEW */}
 {activeDetailTab === 'overview' && (
 <div className="space-y-6 flex-1 text-xs">
 <div className="bg-background p-4 rounded-xl border border-border space-y-2">
 <span className="text-text-muted uppercase tracking-wider font-semibold text-2xs block">Explanation &amp; Threat Context</span>
 <p className="text-text-secondary leading-relaxed font-sans">
 {selectedFinding.explanation || 'Cryptographic primitive analyzed against standard policy guidelines.'}
 </p>
 </div>

 <div className="grid grid-cols-2 gap-3 text-xs">
 <div className="bg-background p-3 rounded-xl border border-border">
 <span className="text-text-muted block mb-1">Location &amp; Line</span>
 <span className="text-text-brand font-mono break-all">
 {selectedFinding.location || 'N/A'}{selectedFinding.line_number ? `:${selectedFinding.line_number}` : ''}
 </span>
 </div>
 <div className="bg-background p-3 rounded-xl border border-border">
 <span className="text-text-muted block mb-1">Key Size</span>
 <span className="text-crypto font-mono font-bold">
 {selectedFinding.key_size !== undefined && selectedFinding.key_size !== null ? `${selectedFinding.key_size} bits` : 'Unbounded / Unknown'}
 </span>
 </div>
 <div className="bg-background p-3 rounded-xl border border-border">
 <span className="text-text-muted block mb-1">Classical Vulnerability</span>
 <span className="text-high font-mono font-bold">
 {selectedFinding.classical_risk || 'LOW'}
 </span>
 </div>
 <div className="bg-background p-3 rounded-xl border border-border">
 <span className="text-text-muted block mb-1">Quantum Relevance</span>
 <span className="text-specialized font-mono font-bold">
 {selectedFinding.quantum_relevance || 'CRITICAL'}
 </span>
 </div>
 </div>

 {selectedFinding.recommendation_target && (
 <div className="p-4 rounded-xl bg-surface-2 border border-pqc/30 space-y-1.5">
 <span className="text-crypto font-bold flex items-center gap-1.5">
 <Wrench size={14} />
 <span>Recommended Migration Target</span>
 </span>
 <p className="text-text-secondary">
 Migrate to <strong className="text-crypto font-mono">{selectedFinding.recommendation_target}</strong> {selectedFinding.pqc_migration && selectedFinding.pqc_migration !== selectedFinding.recommendation_target ? `(${selectedFinding.pqc_migration})` : ''}.
 </p>
 </div>
 )}
 
 {selectedFinding.status === 'DISMISSED_FALSE_POSITIVE' && (
 <div className="p-4 rounded-xl bg-bg-1 border border-border-soft space-y-1.5">
 <span className="text-text-secondary font-bold flex items-center gap-1.5 text-xs">
 <XCircle size={14} />
 <span>Dismissed as False Positive</span>
 </span>
 <p className="text-text-secondary text-xs italic">
 "{selectedFinding.dismissal_reason}"
 </p>
 </div>
 )}
 </div>
 )}

 {/* TAB 2: CBOM VIEW */}
 {activeDetailTab === 'cbom' && (
 <div className="space-y-4 flex-1 text-xs">
 <div className="p-3 rounded-xl bg-background border border-border text-text-secondary">
 <p className="font-semibold text-text-brand mb-1">CycloneDX 1.6 Cryptographic Properties</p>
 <p>Raw cryptographic Bill of Materials descriptor compliant with CycloneDX 1.6 CBOM schema.</p>
 </div>

 <div className="bg-background rounded-xl border border-border p-4 font-mono text-2xs text-crypto overflow-x-auto max-h-96">
 <pre>{JSON.stringify({
 bomFormat: 'CycloneDX',
 specVersion: '1.6',
 type: 'cryptographic-asset',
 name: selectedFinding.algorithm,
 cryptoProperties: {
 assetType: selectedFinding.asset_type || 'algorithm',
 algorithmProperties: {
 primitive: selectedFinding.category || 'public-key',
 parameterSetIdentifier: selectedFinding.algorithm,
 classicalSecurityLevel: selectedFinding.key_size !== undefined && selectedFinding.key_size !== null ? Math.floor(selectedFinding.key_size / 16) : 80,
 nistQuantumSecurityLevel: selectedFinding.quantum_relevance === 'HIGH' || selectedFinding.quantum_relevance === 'CRITICAL' ? 0 : 3,
 },
 },
 evidence: {
 occurrences: [
 {
 location: selectedFinding.location || 'unknown',
 line: selectedFinding.line_number || null,
 },
 ],
 },
 component_id: selectedFinding.component_id,
 scan_id: selectedFinding.scan_id,
 }, null, 2)}</pre>
 </div>
 </div>
 )}

 {/* TAB 3: PQC ASSESSMENT */}
 {activeDetailTab === 'pqc' && (
 <div className="space-y-4 flex-1 text-xs">
 <div className="p-4 rounded-xl bg-surface-2 border border-specialized space-y-2">
 <div className="flex items-center gap-2 text-specialized font-bold">
 <Clock size={16} />
 <span>Mosca Theorem Migration Calculus</span>
 </div>
 <p className="text-text-secondary leading-relaxed font-sans">
 Mosca Inequality: If <strong>X (Shelf Life) + Y (Migration Time) &gt; Z (CRQC Horizon)</strong>, cryptographic data is compromised retroactively by "Harvest Now, Decrypt Later" adversaries.
 </p>
 <div className="grid grid-cols-3 gap-2 pt-2 text-center font-mono">
 <div className="p-2 rounded-lg bg-background border border-border">
 <span className="text-text-muted text-2xs block">Margin</span>
 <span className="text-critical font-bold">{selectedFinding.mosca_margin_years ?? -5} yrs</span>
 </div>
 <div className="p-2 rounded-lg bg-background border border-border">
 <span className="text-text-muted text-2xs block">Mosca Status</span>
 <span className="text-high font-bold">{selectedFinding.mosca_status || 'AT_RISK'}</span>
 </div>
 <div className="p-2 rounded-lg bg-background border border-border">
 <span className="text-text-muted text-2xs block">CI/CD Gate</span>
 <span className={selectedFinding.cicd_pass ? 'text-success font-bold' : 'text-critical font-bold'}>
 {selectedFinding.cicd_pass ? 'PASSED' : 'BLOCKED'}
 </span>
 </div>
 </div>
 </div>

 <div className="bg-background p-4 rounded-xl border border-border space-y-2">
 <h4 className="font-bold text-text-brand">NIST FIPS 203/204 Replacement Target</h4>
 <p className="text-text-secondary">
 Target: <strong className="text-crypto font-mono">{selectedFinding.recommendation_target || 'N/A'}</strong>
 </p>
 {(!selectedFinding.pqc_migration || selectedFinding.pqc_migration !== selectedFinding.recommendation_target) && (
 <p className="text-text-secondary">
 Category: <span className="text-text-brand">{selectedFinding.pqc_migration || 'N/A'}</span>
 </p>
 )}
 </div>
 </div>
 )}

 {/* Bottom Actions */}
 <div className="pt-4 mt-6 border-t border-border flex items-center justify-between gap-3">
 <button
 onClick={() => setSelectedFinding(null)}
 className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-secondary font-semibold text-xs"
 >
 Close Drawer
 </button>

 <div className="flex gap-2">
 {selectedFinding.status === 'LLM_FLAGGED_UNVERIFIED' && (
 <>
 <button
 onClick={() => setShowDismissModal(true)}
 disabled={isReviewing}
 className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-2 text-critical font-bold text-xs border border-critical"
 >
 Dismiss (FP)
 </button>
 <button
 onClick={() => handleReview('CONFIRM')}
 disabled={isReviewing}
 className="px-4 py-2 rounded-xl bg-surface-2 hover:bg-surface-2 text-success font-bold text-xs border border-success"
 >
 {isReviewing ? 'Saving...' : 'Confirm Finding'}
 </button>
 </>
 )}
 <button
 onClick={() => {
 navigate(`/remediation?findingId=${encodeURIComponent(selectedFinding.id)}&algorithm=${encodeURIComponent(selectedFinding.algorithm)}&asset=${encodeURIComponent(selectedFinding.location || selectedFinding.asset_id)}`);
 }}
 className="px-4 py-2 rounded-xl bg-brand hover:bg-brand text-text-muted font-bold text-xs shadow-md flex items-center gap-1.5"
 >
 <Wrench size={14} />
 <span>Propose Remediation Plan</span>
 </button>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Dismissal Reason Modal */}
 {showDismissModal && (
 <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
 <div className="bg-bg-1 border border-border-soft rounded-2xl w-full max-w-md p-6 shadow-md">
 <h3 className="text-lg font-bold text-text-brand mb-2">Dismiss Finding</h3>
 <p className="text-xs text-text-secondary mb-4">Please provide a reason for dismissing this AI-flagged finding.</p>
 <textarea
 value={dismissReason}
 onChange={(e) => setDismissReason(e.target.value)}
 placeholder="e.g. This is a false positive because..."
 className="w-full bg-background border border-border rounded-xl p-3 text-sm text-text-brand placeholder-slate-600 focus:outline-none focus:border-pqc min-h-[100px] mb-4"
 />
 <div className="flex justify-end gap-3">
 <button
 onClick={() => {
 setShowDismissModal(false);
 setDismissReason('');
 }}
 className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-2 text-text-secondary font-semibold text-xs"
 >
 Cancel
 </button>
 <button
 onClick={() => handleReview('DISMISS')}
 disabled={isReviewing || !dismissReason.trim()}
 className="px-4 py-2 rounded-xl bg-critical hover:bg-critical text-text-brand font-bold text-xs disabled:opacity-50"
 >
 {isReviewing ? 'Saving...' : 'Submit Dismissal'}
 </button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
};

export default Findings;
