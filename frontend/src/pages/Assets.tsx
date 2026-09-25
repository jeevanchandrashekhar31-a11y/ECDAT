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
      return <Network size={14} className="text-cyan-400" />;
    }
    if (t.includes('cert') || t.includes('x509')) {
      return <Lock size={14} className="text-violet-400" />;
    }
    if (t.includes('code') || t.includes('call') || t.includes('static')) {
      return <FileCode size={14} className="text-amber-400" />;
    }
    return <Cpu size={14} className="text-emerald-400" />;
  };


  return (
    <div className="space-y-6">
      {/* 1. Header & Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/70">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Layers className="text-cyan-400" size={22} />
              <span>Cryptographic Inventory &amp; Finding Explorer</span>
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              {activeTab === 'assets' ? `${totalAssets} Assets` : `${totalFindings} Findings`}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Search, filter, and inspect discovered cryptographic endpoints, certificates, code usages, and Mosca risks.
          </p>
        </div>

        {/* View Toggle (Asset Grouping vs Direct Finding Explorer) */}
        <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-xl shrink-0">
          <button
            onClick={() => {
              setActiveTab('assets');
              setPage(1);
            }}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'assets'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
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
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ListFilter size={14} />
            <span>Finding Explorer</span>
          </button>
        </div>
      </div>

      {/* Active Scan Context Banner */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Viewing Inventory:</span>
          {selectedScanId && selectedScanId !== 'all' ? (
            <span className="font-mono text-cyan-300 font-semibold flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800 text-2xs uppercase">
                {scans.find((s) => s.id === selectedScanId)?.scanner_type || 'Scan'}
              </span>
              {scans.find((s) => s.id === selectedScanId)?.name || selectedScanId}
            </span>
          ) : (
            <span className="font-mono text-emerald-400 font-semibold flex items-center gap-1.5">
              <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-2xs uppercase">
                Consolidated
              </span>
              All Scans (Static Code + Network Probes + Binaries)
            </span>
          )}
        </div>
        {selectedScanId && selectedScanId !== 'all' && (
          <Link
            to="/assets"
            className="text-2xs text-cyan-400 hover:underline flex items-center gap-1"
          >
            <span>Switch to Consolidated View (All Scans)</span>
          </Link>
        )}
      </div>

      {/* 2. Quick Metric Pill Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-card p-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-slate-400">Total Scanned Assets</p>
            <p className="text-lg font-bold text-white font-mono">{totalAssets}</p>
          </div>
          <Shield size={20} className="text-cyan-400/80" />
        </div>

        <div className="glass-card p-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-slate-400">Mosca At Risk</p>
            <p className="text-lg font-bold text-amber-400 font-mono">{atRiskCount}</p>
          </div>
          <Clock size={20} className="text-amber-400/80" />
        </div>

        <div className="glass-card p-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-medium text-slate-400">Critical Severity</p>
            <p className="text-lg font-bold text-rose-400 font-mono">{criticalCount}</p>
          </div>
          <Zap size={20} className="text-rose-400/80" />
        </div>
      </div>

      {/* 3. Comprehensive Filter & Sort Bar */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 hover:text-cyan-400 transition-colors"
          >
            <Filter size={14} className={showFilters ? "text-cyan-400" : "text-slate-400"} />
            <span>{showFilters ? "Hide Filters & Search" : "Show Filters & Search"}</span>
          </button>
          <button
            onClick={handleResetFilters}
            className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-400 transition-colors"
          >
            <RotateCcw size={12} />
            <span>Reset All</span>
          </button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2.5 text-xs pt-3 border-t border-slate-800">
            {/* Search Input */}
            <div className="relative xl:col-span-2">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search identifier, algorithm, file..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
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
          <div className="p-16 text-center text-slate-400 space-y-3">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
            <p className="text-xs">Querying cryptographic telemetry and Mosca calculus...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-300">
            <p className="text-xs">{error}</p>
          </div>
        ) : activeTab === 'assets' ? (
          assets.length === 0 ? (
            <div className="p-16 text-center text-slate-400">
              <Layers size={44} className="mx-auto text-slate-600 mb-2" />
              <p className="text-sm font-semibold text-slate-300">No cryptographic assets match your criteria</p>
              <p className="text-xs mt-1 text-slate-500">Try broadening your search query or reset active filters.</p>
              <button
                onClick={handleResetFilters}
                className="mt-4 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-semibold transition-colors"
              >
                Reset Active Filters
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800 font-mono">
                    <tr>
                      <th className="py-3.5 px-4">Logical Asset</th>
                      <th className="py-3.5 px-3">Risk & Exposure</th>
                      <th className="py-3.5 px-3">Mosca Status</th>
                      <th className="py-3.5 px-3">Occurrences & Usage</th>
                      <th className="py-3.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-200 font-sans">
                    {assets.map((asset) => (
                      <tr key={`${asset.asset_id}-${selectedScanId || 'all'}`} className="hover:bg-slate-800/40 transition-colors">
                        {/* Asset Identifier & Type */}
                        <td className="py-3.5 px-4 max-w-xs">
                          <div className="flex items-center gap-2">
                            <span className="p-1.5 rounded bg-slate-900 border border-slate-800 shrink-0">
                              {getAssetTypeIcon(asset.asset_type)}
                            </span>
                            <div className="min-w-0">
                              <Link
                                to={`/assets/${encodeURIComponent(asset.asset_id)}${selectedScanId && selectedScanId !== 'all' ? `?scanId=${selectedScanId}` : ''}`}
                                className="font-mono font-bold text-slate-100 hover:text-cyan-400 truncate block transition-colors"
                                title={asset.primary_identifier}
                              >
                                {asset.primary_identifier || asset.asset_id}
                              </Link>
                              <span className="text-[11px] text-slate-400 capitalize block">
                                {asset.asset_type.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Highest Severity & Exposure */}
                        <td className="py-3.5 px-3">
                          <SeverityBadge severity={asset.highest_severity} size="sm" />
                          <div className="text-[10px] text-slate-500 mt-1 capitalize">
                            Source: {(asset.source || "Unknown").replace(/_/g, ' ')}
                          </div>
                        </td>

                        {/* Mosca Status */}
                        <td className="py-3.5 px-3">
                          <MoscaStatusBadge status={asset.mosca_status} />
                        </td>

                        {/* Occurrences & Usage */}
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-1.5 text-xs text-slate-300">
                            <Layers className="w-3.5 h-3.5 text-slate-500" />
                            <span className="font-mono font-bold text-cyan-300">{asset.findings_count || 1}</span> Occurrence{(asset.findings_count || 1) !== 1 && 's'}
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1.5 max-w-[200px]">
                            {(asset.usage_types || []).slice(0, 2).map((u, i) => (
                              <span key={`u-${i}`} className="text-[9px] uppercase px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700">{u.replace(/_/g, ' ')}</span>
                            ))}
                            {(asset.evidence_types || []).slice(0, 2).map((e, i) => (
                              <span key={`e-${i}`} className="text-[9px] uppercase px-1.5 py-0.5 bg-slate-900 rounded border border-slate-800 text-slate-400">{e.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                        </td>

                        {/* Inspect Details */}
                        <td className="py-3.5 px-4 text-right">
                          <Link
                            to={`/assets/${encodeURIComponent(asset.asset_id)}${selectedScanId && selectedScanId !== 'all' ? `?scanId=${selectedScanId}` : ''}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-colors"
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
              <div className="p-3 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <span>Items per page:</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 focus:outline-none"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <span className="ml-2 text-slate-500">
                    Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalAssets)} of {totalAssets}{' '}
                    assets
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
                    title="Previous page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span className="px-2 font-mono text-slate-300">
                    {page} / {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(page + 1)}
                    className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
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
          <div className="p-16 text-center text-slate-400">
            <ListFilter size={44} className="mx-auto text-slate-600 mb-2" />
            <p className="text-sm font-semibold text-slate-300">No individual findings match the current filter</p>
            <button
              onClick={handleResetFilters}
              className="mt-4 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-semibold transition-colors"
            >
              Reset Active Filters
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/90 text-slate-400 uppercase tracking-wider text-[11px] border-b border-slate-800 font-mono">
                  <tr>
                    <th className="py-3.5 px-4">Algorithm &amp; Key Size</th>
                    <th className="py-3.5 px-3">Location / Context</th>
                    <th className="py-3.5 px-3">Quantum Status</th>
                    <th className="py-3.5 px-4 text-right">View Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-200 font-sans">
                  {findings.map((f) => (
                    <tr key={`${f.id}-${selectedScanId || 'all'}`} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 font-mono">
                          <span className="font-bold text-white">{f.algorithm}</span>
                          {f.key_size && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">
                              {f.key_size}b
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 capitalize">{f.category || 'primitive'}</span>
                      </td>

                      <td
                        className="py-3.5 px-3 font-mono text-[11px] max-w-xs truncate text-slate-300"
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
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline font-semibold"
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
            <div className="p-3 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between text-xs text-slate-400">
              <span className="text-slate-500">
                Showing {(findingsPage - 1) * pageSize + 1} - {Math.min(findingsPage * pageSize, totalFindings)} of{' '}
                {totalFindings} findings
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  disabled={findingsPage <= 1}
                  onClick={() => setFindingsPage(findingsPage - 1)}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="px-2 font-mono text-slate-300">
                  {findingsPage} / {findingsTotalPages}
                </span>
                <button
                  disabled={findingsPage >= findingsTotalPages}
                  onClick={() => setFindingsPage(findingsPage + 1)}
                  className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors"
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
