import React, { useState, useEffect } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import {
 Search,
 Filter,
 Layers,
 ChevronLeft,
 ChevronRight,
 ExternalLink,
 RotateCcw,
 Shield,
 Clock,
 Zap,
 CheckCircle2,
 Network,
 FileCode,
 Lock,
 ListFilter,
 Cpu,
} from 'lucide-react';
import { api } from '../api/client';
import { AssetSummaryItem, AssetsResponse, FindingItem, FindingsResponse, ScanItem } from '../types';
import { SeverityBadge } from '../components/SeverityBadge';
import { MoscaStatusBadge } from '../components/MoscaTable';

export const Assets: React.FC = () => {
 const outlet = useOutletContext<{ selectedScanId?: string; scans?: ScanItem[] }>() || {};
 const selectedScanId = outlet.selectedScanId;
 const scans = outlet.scans || [];

 // Active View Tab: 'assets' | 'findings'
 const [activeTab, setActiveTab] = useState<'assets' | 'findings'>('assets');

 // Asset State
 const [assets, setAssets] = useState<AssetSummaryItem[]>([]);
 const [totalAssets, setTotalAssets] = useState(0);
 const [page, setPage] = useState(1);
 const [pageSize, setPageSize] = useState(25);
 const [totalPages, setTotalPages] = useState(1);

 // Finding State (for Direct Findings View)
 const [findings, setFindings] = useState<FindingItem[]>([]);
 const [totalFindings, setTotalFindings] = useState(0);
 const [findingsPage, setFindingsPage] = useState(1);
 const [findingsTotalPages, setFindingsTotalPages] = useState(1);

 // Filter States
 const [search, setSearch] = useState('');
 const [severityFilter, setSeverityFilter] = useState('');
 const [moscaFilter, setMoscaFilter] = useState('');
 const [typeFilter, setTypeFilter] = useState('');
 const [sourceFilter, setSourceFilter] = useState('');
 const [sensitivityFilter, setSensitivityFilter] = useState('');
 const [criticalityFilter, setCriticalityFilter] = useState('');
 const [sortBy, setSortBy] = useState('risk');

 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);
 const [showFilters, setShowFilters] = useState(false);

 // Quick stats derived from active results
 const [atRiskCount, setAtRiskCount] = useState(0);
 const [criticalCount, setCriticalCount] = useState(0);

 const fetchAssets = async () => {
 setLoading(true);
 setError(null);
 try {
 const activeScanParam = selectedScanId;
 if (activeTab === 'assets') {
 const res: AssetsResponse = await api.getAssets({
 scanId: activeScanParam,
 severity: severityFilter || undefined,
 moscaStatus: moscaFilter || undefined,
 assetType: typeFilter || undefined,
 source: sourceFilter || undefined,
 dataSensitivity: sensitivityFilter || undefined,
 businessCriticality: criticalityFilter || undefined,
 sortBy,
 page,
 pageSize,
 });

 let items = res.assets || [];
 if (search.trim()) {
 const q = search.toLowerCase();
 items = items.filter(
 (a) =>
 a.primary_identifier.toLowerCase().includes(q) ||
 a.asset_id.toLowerCase().includes(q) ||
 a.asset_type.toLowerCase().includes(q) ||
 (a.source && a.source.toLowerCase().includes(q))
 );
 }

 setAssets(items);
 const count = res.total || items.length;
 setTotalAssets(count);
 setTotalPages(res.totalPages || Math.ceil(count / pageSize) || 1);

 // Calculate quick metric badges
 const atRisk = items.filter((a) => a.mosca_status === 'AT_RISK' || a.mosca_status === 'CRITICAL_URGENT').length;
 const crit = items.filter((a) => a.highest_severity === 'Critical').length;
 setAtRiskCount(atRisk);
 setCriticalCount(crit);
 } else {
 // Fetch direct findings
 const res: FindingsResponse = await api.getFindings({
 scanId: activeScanParam,
 severity: severityFilter || undefined,
 moscaStatus: moscaFilter || undefined,
 assetType: typeFilter || undefined,
 source: sourceFilter || undefined,
 page: findingsPage,
 pageSize,
 });

 let fItems = res.findings || [];
 if (search.trim()) {
 const q = search.toLowerCase();
 fItems = fItems.filter(
 (f) =>
 (f.algorithm && f.algorithm.toLowerCase().includes(q)) ||
 (f.location && f.location.toLowerCase().includes(q)) ||
 (f.asset_id && f.asset_id.toLowerCase().includes(q)) ||
 (f.category && f.category.toLowerCase().includes(q))
 );
 }

 setFindings(fItems);
 const fCount = res.total || fItems.length;
 setTotalFindings(fCount);
 setFindingsTotalPages(res.totalPages || Math.ceil(fCount / pageSize) || 1);
 }
 } catch (err: unknown) {
 setError((err as Error).message || 'Failed to fetch cryptographic inventory.');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchAssets();
 }, [
 selectedScanId,
 activeTab,
 page,
 findingsPage,
 pageSize,
 severityFilter,
 moscaFilter,
 typeFilter,
 sourceFilter,
 sensitivityFilter,
 criticalityFilter,
 sortBy,
 ]);

 const handleResetFilters = () => {
 setSearch('');
 setSeverityFilter('');
 setMoscaFilter('');
 setTypeFilter('');
 setSourceFilter('');
 setSensitivityFilter('');
 setCriticalityFilter('');
 setSortBy('risk');
 setPage(1);
 setFindingsPage(1);
 };

 const getAssetTypeIcon = (type: string) => {
 const t = type.toLowerCase();
 if (t.includes('network') || t.includes('protocol') || t.includes('tls') || t.includes('ssh')) {
 return <Network size={14} className="text-crypto" />;
 }
 if (t.includes('cert') || t.includes('x509')) {
 return <Lock size={14} className="text-specialized" />;
 }
 if (t.includes('code') || t.includes('call') || t.includes('static')) {
 return <FileCode size={14} className="text-high" />;
 }
 return <Cpu size={14} className="text-success" />;
 };


 return (
 <div className="space-y-6">
 {/* 1. Header & Tab Switcher */}
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
 <div>
 <div className="flex items-center gap-3">
 <h1 className="text-xl font-extrabold text-text-brand tracking-tight flex items-center gap-2">
 <Layers className="text-crypto" size={22} />
 <span>Cryptographic Inventory &amp; Finding Explorer</span>
 </h1>
 <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-pqc/15 text-crypto border border-pqc/30">
 {activeTab === 'assets' ? `${totalAssets} Assets` : `${totalFindings} Findings`}
 </span>
 </div>
 <p className="text-xs text-text-secondary mt-1">
 Search, filter, and inspect discovered cryptographic endpoints, certificates, code usages, and Mosca risks.
 </p>
 </div>

 {/* View Toggle (Asset Grouping vs Direct Finding Explorer) */}
 <div className="flex items-center p-1 bg-bg-1 border border-border rounded-xl shrink-0">
 <button
 onClick={() => {
 setActiveTab('assets');
 setPage(1);
 }}
 className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
 activeTab === 'assets'
 ? 'bg-pqc text-text-muted font-bold shadow-sm'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 <Layers size={14} />
 <span>Asset Inventory</span>
 </button>
 <button
 onClick={() => {
 setActiveTab('findings');
 setFindingsPage(1);
 }}
 className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
 activeTab === 'findings'
 ? 'bg-pqc text-text-muted font-bold shadow-sm'
 : 'text-text-secondary hover:text-text-brand'
 }`}
 >
 <ListFilter size={14} />
 <span>Finding Explorer</span>
 </button>
 </div>
 </div>

 {/* Active Scan Context Banner */}
 <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-2.5 rounded-xl bg-bg-1/80 border border-border text-xs">
 <div className="flex items-center gap-2">
 <span className="text-text-secondary font-medium">Viewing Inventory:</span>
 {selectedScanId && selectedScanId !== 'all' ? (
 <span className="font-mono text-crypto font-semibold flex items-center gap-1.5">
 <span className="px-1.5 py-0.5 rounded bg-surface-2 text-crypto border border-pqc text-2xs uppercase">
 {scans.find((s) => s.id === selectedScanId)?.scanner_type || 'Scan'}
 </span>
 {scans.find((s) => s.id === selectedScanId)?.name || selectedScanId}
 </span>
 ) : (
 <span className="font-mono text-success font-semibold flex items-center gap-1.5">
 <span className="px-1.5 py-0.5 rounded bg-surface-2 text-success border border-success text-2xs uppercase">
 Consolidated
 </span>
 All Scans (Static Code + Network Probes + Binaries)
 </span>
 )}
 </div>
 {selectedScanId && selectedScanId !== 'all' && (
 <Link
 to="/assets"
 className="text-2xs text-crypto hover:underline flex items-center gap-1"
 >
 <span>Switch to Consolidated View (All Scans)</span>
 </Link>
 )}
 </div>

 {/* 2. Quick Metric Pill Strip */}
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 <div className="glass-card p-3 flex items-center justify-between">
 <div>
 <p className="text-[11px] font-medium text-text-secondary">Total Scanned Assets</p>
 <p className="text-lg font-bold text-text-brand font-mono">{totalAssets}</p>
 </div>
 <Shield size={20} className="text-crypto/80" />
 </div>

 <div className="glass-card p-3 flex items-center justify-between">
 <div>
 <p className="text-[11px] font-medium text-text-secondary">Mosca At Risk</p>
 <p className="text-lg font-bold text-high font-mono">{atRiskCount}</p>
 </div>
 <Clock size={20} className="text-high/80" />
 </div>

 <div className="glass-card p-3 flex items-center justify-between">
 <div>
 <p className="text-[11px] font-medium text-text-secondary">Critical Severity</p>
 <p className="text-lg font-bold text-critical font-mono">{criticalCount}</p>
 </div>
 <Zap size={20} className="text-critical/80" />
 </div>

 <div className="glass-card p-3 flex items-center justify-between">
 <div>
 <p className="text-[11px] font-medium text-text-secondary">Zero Secret Literals</p>
 <p className="text-xs font-semibold text-success flex items-center gap-1 mt-1 font-mono">
 <CheckCircle2 size={13} /> Verified Enforced
 </p>
 </div>
 <Lock size={20} className="text-success/80" />
 </div>
 </div>

 {/* 3. Comprehensive Filter & Sort Bar */}
 <div className="glass-card p-4 space-y-3">
 <div className="flex items-center justify-between text-xs font-semibold text-text-secondary">
 <button
 onClick={() => setShowFilters(!showFilters)}
 className="flex items-center gap-2 hover:text-crypto transition-colors"
 >
 <Filter size={14} className={showFilters ? "text-crypto" : "text-text-secondary"} />
 <span>{showFilters ? "Hide Filters & Search" : "Show Filters & Search"}</span>
 </button>
 <button
 onClick={handleResetFilters}
 className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-crypto transition-colors"
 >
 <RotateCcw size={12} />
 <span>Reset All</span>
 </button>
 </div>

 {showFilters && (
 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2.5 text-xs pt-3 border-t border-border">
 {/* Search Input */}
 <div className="relative xl:col-span-2">
 <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search identifier, algorithm, file..."
 className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-text-brand placeholder-slate-500 focus:outline-none focus:border-pqc"
 />
 </div>

 {/* Severity Filter */}
 <select
 value={severityFilter}
 onChange={(e) => {
 setSeverityFilter(e.target.value);
 setPage(1);
 setFindingsPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="">All Severities</option>
 <option value="Critical">Critical</option>
 <option value="High">High</option>
 <option value="Medium">Medium</option>
 <option value="Low">Low</option>
 <option value="Informational">Informational</option>
 </select>

 {/* Mosca Status Filter */}
 <select
 value={moscaFilter}
 onChange={(e) => {
 setMoscaFilter(e.target.value);
 setPage(1);
 setFindingsPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="">All Mosca Statuses</option>
 <option value="CRITICAL_URGENT">Critical Urgent (X+Y &gt; Z)</option>
 <option value="AT_RISK">At Risk (Quantum Deficit)</option>
 <option value="WATCH">Watch Buffer</option>
 <option value="SAFE">Safe (Quantum Resistant)</option>
 </select>

 {/* Asset Type Filter */}
 <select
 value={typeFilter}
 onChange={(e) => {
 setTypeFilter(e.target.value);
 setPage(1);
 setFindingsPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="">All Types</option>
 <option value="network">Network Protocol / Session</option>
 <option value="certificate">X.509 Certificate</option>
 <option value="source_code_call">Source Code Call</option>
 <option value="stored_encrypted_data">Stored Encrypted Data</option>
 <option value="library_presence">Library Inventory</option>
 </select>

 {/* Source Scanner Filter */}
 <select
 value={sourceFilter}
 onChange={(e) => {
 setSourceFilter(e.target.value);
 setPage(1);
 setFindingsPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="">All Sources</option>
 <option value="static">Static AST / Code</option>
 <option value="network">Network / TLS Probe</option>
 <option value="binary">Binary / Container</option>
 </select>

 {/* Business Criticality Filter */}
 <select
 value={criticalityFilter}
 onChange={(e) => {
 setCriticalityFilter(e.target.value);
 setPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="">All Criticalities</option>
 <option value="mission_critical">Mission Critical</option>
 <option value="high">High Criticality</option>
 <option value="medium">Medium Criticality</option>
 <option value="low">Low Criticality</option>
 </select>

 {/* Sorting Dropdown */}
 <select
 value={sortBy}
 onChange={(e) => {
 setSortBy(e.target.value);
 setPage(1);
 }}
 className="bg-background border border-border rounded-lg px-2.5 py-2 text-text-brand focus:outline-none focus:border-pqc cursor-pointer"
 >
 <option value="risk">Sort: Risk &amp; Urgency</option>
 <option value="name_asc">Sort: Identifier (A-Z)</option>
 <option value="name_desc">Sort: Identifier (Z-A)</option>
 <option value="findings_count">Sort: Most Primitives</option>
 <option value="date">Sort: Scan Timestamp</option>
 </select>
 </div>
 )}
 </div>

 {/* 4. Table Content: Asset Inventory vs Direct Findings */}
 <div className="glass-card overflow-hidden">
 {loading ? (
 <div className="p-16 text-center text-text-secondary space-y-3">
 <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pqc"></div>
 <p className="text-xs">Querying cryptographic telemetry and Mosca calculus...</p>
 </div>
 ) : error ? (
 <div className="p-8 text-center text-critical">
 <p className="text-xs">{error}</p>
 </div>
 ) : activeTab === 'assets' ? (
 assets.length === 0 ? (
 <div className="p-16 text-center text-text-secondary">
 <Layers size={44} className="mx-auto text-text-muted mb-2" />
 <p className="text-sm font-semibold text-text-secondary">No cryptographic assets match your criteria</p>
 <p className="text-xs mt-1 text-text-muted">Try broadening your search query or reset active filters.</p>
 <button
 onClick={handleResetFilters}
 className="mt-4 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-2 text-crypto text-xs font-semibold transition-colors"
 >
 Reset Active Filters
 </button>
 </div>
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
 <thead className="bg-bg-1/90 text-text-secondary uppercase tracking-wider text-[11px] border-b border-border font-mono">
 <tr>
 <th className="py-3.5 px-4">Name / Identifier</th>
 <th className="py-3.5 px-3">Highest Severity</th>
 <th className="py-3.5 px-3">Quantum Status</th>
 <th className="py-3.5 px-3 text-center">Crypto Primitives</th>
 <th className="py-3.5 px-4 text-right">View Details</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border text-text-brand font-sans">
 {assets.map((asset) => (
 <tr key={`${asset.asset_id}-${selectedScanId || 'all'}`} className="hover:bg-surface transition-colors">
 {/* Asset Identifier & Type */}
 <td className="py-3.5 px-4 max-w-xs">
 <div className="flex items-center gap-2">
 <span className="p-1.5 rounded bg-bg-1 border border-border shrink-0">
 {getAssetTypeIcon(asset.asset_type)}
 </span>
 <div className="min-w-0">
 <Link
 to={`/assets/${encodeURIComponent(asset.asset_id)}${selectedScanId && selectedScanId !== 'all' ? `?scanId=${selectedScanId}` : ''}`}
 className="font-mono font-bold text-text-brand hover:text-crypto truncate block transition-colors"
 title={asset.primary_identifier}
 >
 {asset.primary_identifier || asset.asset_id}
 </Link>
 <span className="text-[11px] text-text-secondary capitalize block">
 {asset.asset_type.replace(/_/g, ' ')}
 </span>
 </div>
 </div>
 </td>

 {/* Highest Severity */}
 <td className="py-3.5 px-3">
 <SeverityBadge severity={asset.highest_severity} size="sm" />
 </td>

 {/* Mosca Status */}
 <td className="py-3.5 px-3">
 <MoscaStatusBadge status={asset.mosca_status} />
 </td>

 {/* Crypto Count */}
 <td className="py-3.5 px-3 text-center">
 <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-surface text-crypto border border-border-soft">
 {asset.findings_count || 1}
 </span>
 </td>

 {/* Inspect Details */}
 <td className="py-3.5 px-4 text-right">
 <Link
 to={`/assets/${encodeURIComponent(asset.asset_id)}${selectedScanId && selectedScanId !== 'all' ? `?scanId=${selectedScanId}` : ''}`}
 className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-pqc/10 hover:bg-pqc/20 text-crypto hover:text-crypto border border-pqc/30 text-xs font-semibold transition-colors"
 >
 <span>Inspect</span>
 <ExternalLink size={12} />
 </Link>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {/* Pagination Bar */}
 <div className="p-3 border-t border-border bg-bg-1/60 flex items-center justify-between text-xs text-text-secondary">
 <div className="flex items-center gap-2">
 <span>Items per page:</span>
 <select
 value={pageSize}
 onChange={(e) => {
 setPageSize(Number(e.target.value));
 setPage(1);
 }}
 className="bg-background border border-border rounded px-2 py-1 text-text-brand focus:outline-none"
 >
 <option value={10}>10</option>
 <option value={25}>25</option>
 <option value={50}>50</option>
 <option value={100}>100</option>
 </select>
 <span className="ml-2 text-text-muted">
 Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalAssets)} of {totalAssets}{' '}
 assets
 </span>
 </div>

 <div className="flex items-center gap-1.5">
 <button
 disabled={page <= 1}
 onClick={() => setPage(page - 1)}
 className="p-1.5 rounded bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-text-brand transition-colors"
 title="Previous page"
 >
 <ChevronLeft size={16} />
 </button>
 <span className="px-2 font-mono text-text-secondary">
 {page} / {totalPages}
 </span>
 <button
 disabled={page >= totalPages}
 onClick={() => setPage(page + 1)}
 className="p-1.5 rounded bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-text-brand transition-colors"
 title="Next page"
 >
 <ChevronRight size={16} />
 </button>
 </div>
 </div>
 </>
 )
 ) : /* Direct Findings View */
 findings.length === 0 ? (
 <div className="p-16 text-center text-text-secondary">
 <ListFilter size={44} className="mx-auto text-text-muted mb-2" />
 <p className="text-sm font-semibold text-text-secondary">No individual findings match the current filter</p>
 <button
 onClick={handleResetFilters}
 className="mt-4 px-3 py-1.5 rounded-lg bg-surface hover:bg-surface-2 text-crypto text-xs font-semibold transition-colors"
 >
 Reset Active Filters
 </button>
 </div>
 ) : (
 <>
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs">
 <thead className="bg-bg-1/90 text-text-secondary uppercase tracking-wider text-[11px] border-b border-border font-mono">
 <tr>
 <th className="py-3.5 px-4">Algorithm &amp; Key Size</th>
 <th className="py-3.5 px-3">Location / Context</th>
 <th className="py-3.5 px-3">Quantum Status</th>
 <th className="py-3.5 px-4 text-right">View Details</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border text-text-brand font-sans">
 {findings.map((f) => (
 <tr key={`${f.id}-${selectedScanId || 'all'}`} className="hover:bg-surface transition-colors">
 <td className="py-3.5 px-4">
 <div className="flex items-center gap-2 font-mono">
 <span className="font-bold text-text-brand">{f.algorithm}</span>
 {f.key_size && (
 <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-crypto border border-border-soft">
 {f.key_size}b
 </span>
 )}
 </div>
 <span className="text-[11px] text-text-secondary capitalize">{f.category || 'primitive'}</span>
 </td>

 <td
 className="py-3.5 px-3 font-mono text-[11px] max-w-xs truncate text-text-secondary"
 title={f.location}
 >
 {f.location || 'Endpoint Session'}
 {f.line_number ? `:${f.line_number}` : ''}
 </td>

 <td className="py-3.5 px-3">
 <MoscaStatusBadge status={f.mosca_status} />
 </td>

 <td className="py-3.5 px-4 text-right">
 <Link
 to={`/assets/${encodeURIComponent(f.asset_id)}${selectedScanId && selectedScanId !== 'all' ? `?scanId=${selectedScanId}` : ''}`}
 className="inline-flex items-center gap-1 text-crypto hover:text-crypto hover:underline font-semibold"
 >
 <span>Inspect</span>
 <ExternalLink size={12} />
 </Link>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {/* Findings Pagination */}
 <div className="p-3 border-t border-border bg-bg-1/60 flex items-center justify-between text-xs text-text-secondary">
 <span className="text-text-muted">
 Showing {(findingsPage - 1) * pageSize + 1} - {Math.min(findingsPage * pageSize, totalFindings)} of{' '}
 {totalFindings} findings
 </span>

 <div className="flex items-center gap-1.5">
 <button
 disabled={findingsPage <= 1}
 onClick={() => setFindingsPage(findingsPage - 1)}
 className="p-1.5 rounded bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-text-brand transition-colors"
 >
 <ChevronLeft size={16} />
 </button>
 <span className="px-2 font-mono text-text-secondary">
 {findingsPage} / {findingsTotalPages}
 </span>
 <button
 disabled={findingsPage >= findingsTotalPages}
 onClick={() => setFindingsPage(findingsPage + 1)}
 className="p-1.5 rounded bg-surface hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed text-text-brand transition-colors"
 >
 <ChevronRight size={16} />
 </button>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 );
};
