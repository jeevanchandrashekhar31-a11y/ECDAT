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
  const [algorithmFilter, setAlgorithmFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active selected finding drawer
  const [selectedFinding, setSelectedFinding] = useState<FindingItem | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'cbom' | 'pqc'>('overview');

  // Triggering scan state
  const [triggeringScan, setTriggeringScan] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    setErrorDetails(null);

    try {
      const activeScan = selectedScanId;
      const res = await api.getFindings({
        scanId: activeScan,
        severity: severityFilter !== 'ALL' ? severityFilter : undefined,
        algorithm: algorithmFilter.trim() || undefined,
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
  }, [selectedScanId, severityFilter, algorithmFilter]);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  // Handle start demo scan from empty state
  const handleStartDemoScan = async () => {
    setTriggeringScan(true);
    setScanMessage(null);
    try {
      const seedRes = await api.seedDemoTenant();
      setScanMessage(`Scan initiated successfully (${seedRes.scan_id}). Reloading findings...`);
      await fetchFindings();
    } catch (err: unknown) {
      const e = err as Error;
      setScanMessage(`Failed to trigger scan: ${e.message}`);
    } finally {
      setTriggeringScan(false);
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
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'high':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'medium':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
      case 'low':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  const getMoscaBadgeClass = (status: MoscaStatus | string) => {
    const s = String(status).toUpperCase();
    switch (s) {
      case 'CRITICAL_URGENT':
        return 'bg-rose-950/80 text-rose-400 border-rose-600 animate-pulse';
      case 'AT_RISK':
        return 'bg-amber-950/80 text-amber-400 border-amber-600';
      case 'WATCH':
        return 'bg-yellow-950/80 text-yellow-400 border-yellow-600';
      case 'SAFE':
        return 'bg-emerald-950/80 text-emerald-400 border-emerald-600';
      default:
        return 'bg-slate-900 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Shield className="text-cyan-400" size={22} />
              <span>Cryptographic Findings</span>
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono">
              {totalFindings} Found
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Discovered cryptographic primitives, key sizes, vulnerabilities, and post-quantum readiness assessments.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchFindings()}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
            title="Refresh findings"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin text-cyan-400' : ''} />
          </button>
          <button
            onClick={handleStartDemoScan}
            disabled={triggeringScan}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 flex items-center gap-2 transition-all disabled:opacity-50"
          >
            {triggeringScan ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            <span>{triggeringScan ? 'Running Scan...' : 'Start / Seed Scan'}</span>
          </button>
        </div>
      </div>

      {scanMessage && (
        <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-300 flex items-center gap-2">
          <CheckCircle size={15} className="text-cyan-400 shrink-0" />
          <span>{scanMessage}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="glass-card p-4 rounded-xl border border-slate-800/80 bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              placeholder="Search algorithm, file location, explanation..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Severity Filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Filter size={13} className="text-cyan-400" />
            <span>Severity:</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="ALL">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="informational">Informational</option>
            </select>
          </div>

          {/* Algorithm Filter */}
          <input
            type="text"
            placeholder="Filter Algorithm (e.g. RSA, 3DES)"
            value={algorithmFilter}
            onChange={(e) => setAlgorithmFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-44"
          />
        </div>
      </div>

      {/* REAL LOADING STATE */}
      {loading && findings.length === 0 && (
        <div className="glass-card p-12 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col items-center justify-center text-center">
          <Loader2 size={32} className="text-cyan-400 animate-spin mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">Loading Findings</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Querying authoritative backend findings and verifying cryptographic risk classification...
          </p>
        </div>
      )}

      {/* REAL ERROR STATE (Backend Error Shape Display) */}
      {!loading && errorDetails && (
        <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-rose-200 space-y-3">
          <div className="flex items-center gap-2 text-rose-400">
            <XCircle size={20} />
            <h3 className="text-sm font-bold">Backend Findings Query Error ({errorDetails.status || '500'})</h3>
          </div>
          <p className="text-xs text-rose-300 font-medium">{errorDetails.message}</p>
          {errorDetails.code && (
            <div className="text-2xs font-mono bg-slate-950 p-2.5 rounded-lg border border-rose-900 text-rose-300">
              Code: {errorDetails.code}
            </div>
          )}
          <button
            onClick={() => fetchFindings()}
            className="px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-white text-xs font-semibold"
          >
            Retry Query
          </button>
        </div>
      )}

      {/* REAL EMPTY STATE (Genuinely empty tenant before scan) */}
      {!loading && !errorDetails && filteredFindings.length === 0 && (
        <div className="glass-card p-12 rounded-2xl border border-slate-800 bg-slate-900/60 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center mx-auto">
            <Shield size={24} />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-bold text-white mb-1">No Cryptographic Findings Detected</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This demo tenant has not executed any cryptographic scans yet, or no findings match the selected filter.
              Trigger a scan below to discover cryptographic primitives, identify quantum vulnerabilities, and populate findings.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={handleStartDemoScan}
              disabled={triggeringScan}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 flex items-center gap-2"
            >
              {triggeringScan ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              <span>{triggeringScan ? 'Triggering Scan...' : 'Start Demo Scan'}</span>
            </button>
          </div>
        </div>
      )}

      {/* FINDINGS TABLE */}
      {!loading && !errorDetails && filteredFindings.length > 0 && (
        <div className="glass-card rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 text-2xs uppercase tracking-wider font-semibold">
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Algorithm / Primitive</th>
                  <th className="py-3 px-4">Key Size</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Location / File</th>
                  <th className="py-3 px-4">Mosca Quantum Risk</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredFindings.map((finding) => (
                  <tr
                    key={finding.id}
                    onClick={() => setSelectedFinding(finding)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors group"
                  >
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-2xs font-bold border ${getSeverityBadgeClass(finding.severity)}`}>
                        {finding.severity || 'Medium'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-100 flex items-center gap-1.5">
                      <Cpu size={14} className="text-cyan-400 shrink-0" />
                      <span>{finding.algorithm}</span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">
                      {finding.key_size ? `${finding.key_size} bits` : <span className="text-slate-600">N/A</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-medium">
                      {finding.category || 'cryptographic-asset'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400 text-2xs max-w-xs truncate" title={finding.location}>
                      {finding.location || 'Runtime / External'}
                      {finding.line_number && <span className="text-cyan-400 ml-1">:{finding.line_number}</span>}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex px-2 py-0.5 rounded text-2xs font-mono font-bold border ${getMoscaBadgeClass(finding.mosca_status)}`}>
                        {finding.mosca_status || 'SAFE'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFinding(finding);
                        }}
                        className="inline-flex items-center gap-1 text-2xs text-cyan-400 hover:text-cyan-300 font-semibold"
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
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full overflow-y-auto p-6 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-start justify-between pb-4 mb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border ${getSeverityBadgeClass(selectedFinding.severity)}`}>
                    {selectedFinding.severity}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold border ${getMoscaBadgeClass(selectedFinding.mosca_status)}`}>
                    {selectedFinding.mosca_status}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white font-mono flex items-center gap-2">
                  <Cpu size={18} className="text-cyan-400" />
                  <span>{selectedFinding.algorithm}</span>
                </h2>
                <p className="text-xs text-slate-400">Finding ID: <code className="text-cyan-300 font-mono">{selectedFinding.id}</code></p>
              </div>

              <button
                onClick={() => setSelectedFinding(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X size={18} />
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-800 mb-6 text-xs font-semibold">
              <button
                onClick={() => setActiveDetailTab('overview')}
                className={`pb-2.5 px-4 transition-colors border-b-2 ${
                  activeDetailTab === 'overview'
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Risk Overview
              </button>
              <button
                onClick={() => setActiveDetailTab('cbom')}
                className={`pb-2.5 px-4 transition-colors border-b-2 flex items-center gap-1.5 ${
                  activeDetailTab === 'cbom'
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 size={13} />
                <span>CBOM Component View</span>
              </button>
              <button
                onClick={() => setActiveDetailTab('pqc')}
                className={`pb-2.5 px-4 transition-colors border-b-2 flex items-center gap-1.5 ${
                  activeDetailTab === 'pqc'
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sparkles size={13} />
                <span>PQC Assessment Detail</span>
              </button>
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeDetailTab === 'overview' && (
              <div className="space-y-6 flex-1 text-xs">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <span className="text-slate-500 uppercase tracking-wider font-semibold text-2xs block">Explanation &amp; Threat Context</span>
                  <p className="text-slate-300 leading-relaxed font-sans">
                    {selectedFinding.explanation || 'Cryptographic primitive analyzed against standard policy guidelines.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block mb-1">Location &amp; Line</span>
                    <span className="text-slate-200 font-mono break-all">
                      {selectedFinding.location || 'N/A'}{selectedFinding.line_number ? `:${selectedFinding.line_number}` : ''}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block mb-1">Key Size</span>
                    <span className="text-cyan-300 font-mono font-bold">
                      {selectedFinding.key_size !== undefined && selectedFinding.key_size !== null ? `${selectedFinding.key_size} bits` : 'Unbounded / Unknown'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block mb-1">Classical Vulnerability</span>
                    <span className="text-amber-300 font-mono font-bold">
                      {selectedFinding.classical_risk || 'LOW'}
                    </span>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                    <span className="text-slate-500 block mb-1">Quantum Relevance</span>
                    <span className="text-violet-300 font-mono font-bold">
                      {selectedFinding.quantum_relevance || 'CRITICAL'}
                    </span>
                  </div>
                </div>

                {selectedFinding.recommendation_target && (
                  <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-500/30 space-y-1.5">
                    <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                      <Wrench size={14} />
                      <span>Recommended Migration Target</span>
                    </span>
                    <p className="text-slate-300">
                      Migrate to <strong className="text-cyan-300 font-mono">{selectedFinding.recommendation_target}</strong> {selectedFinding.pqc_migration && selectedFinding.pqc_migration !== selectedFinding.recommendation_target ? `(${selectedFinding.pqc_migration})` : ''}.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CBOM VIEW */}
            {activeDetailTab === 'cbom' && (
              <div className="space-y-4 flex-1 text-xs">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-400">
                  <p className="font-semibold text-slate-200 mb-1">CycloneDX 1.6 Cryptographic Properties</p>
                  <p>Raw cryptographic Bill of Materials descriptor compliant with CycloneDX 1.6 CBOM schema.</p>
                </div>

                <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-2xs text-cyan-300 overflow-x-auto max-h-96">
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
                <div className="p-4 rounded-xl bg-violet-950/30 border border-violet-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-violet-300 font-bold">
                    <Clock size={16} />
                    <span>Mosca Theorem Migration Calculus</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed font-sans">
                    Mosca Inequality: If <strong>X (Shelf Life) + Y (Migration Time) &gt; Z (CRQC Horizon)</strong>, cryptographic data is compromised retroactively by "Harvest Now, Decrypt Later" adversaries.
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-2 text-center font-mono">
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 text-2xs block">Margin</span>
                      <span className="text-rose-400 font-bold">{selectedFinding.mosca_margin_years ?? -5} yrs</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 text-2xs block">Mosca Status</span>
                      <span className="text-amber-300 font-bold">{selectedFinding.mosca_status || 'AT_RISK'}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-500 text-2xs block">CI/CD Gate</span>
                      <span className={selectedFinding.cicd_pass ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {selectedFinding.cicd_pass ? 'PASSED' : 'BLOCKED'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                  <h4 className="font-bold text-white">NIST FIPS 203/204 Replacement Target</h4>
                  <p className="text-slate-400">
                    Target: <strong className="text-cyan-300 font-mono">{selectedFinding.recommendation_target || 'N/A'}</strong>
                  </p>
                  {(!selectedFinding.pqc_migration || selectedFinding.pqc_migration !== selectedFinding.recommendation_target) && (
                    <p className="text-slate-400">
                      Category: <span className="text-slate-200">{selectedFinding.pqc_migration || 'N/A'}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-4 mt-6 border-t border-slate-800 flex items-center justify-between gap-3">
              <button
                onClick={() => setSelectedFinding(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs"
              >
                Close Drawer
              </button>

              <button
                onClick={() => {
                  navigate(`/remediation?findingId=${encodeURIComponent(selectedFinding.id)}&algorithm=${encodeURIComponent(selectedFinding.algorithm)}&asset=${encodeURIComponent(selectedFinding.location || selectedFinding.asset_id)}`);
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 flex items-center gap-1.5"
              >
                <Wrench size={14} />
                <span>Propose Remediation Plan</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Findings;
