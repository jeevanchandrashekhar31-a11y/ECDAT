import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Filter,
  Search,
  RefreshCw,
  Loader2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api/client';
import { CryptoGraphResponse, GraphFilterMetadata } from '../types';
import { CryptoGraphCanvas } from '../components/graph/CryptoGraphCanvas';
import { EvidenceDrawer } from '../components/EvidenceDrawer';

export const CryptoGraph: React.FC = () => {
  const outlet = useOutletContext<{ selectedScanId?: string }>() || {};
  const selectedScanId = outlet.selectedScanId;

  // Filter states
  const [severity, setSeverity] = useState<string>('ALL');
  const [owner, setOwner] = useState<string>('ALL');
  const [environment, setEnvironment] = useState<string>('ALL');
  const [algorithm, setAlgorithm] = useState<string>('ALL');
  const [pqcReadiness, setPqcReadiness] = useState<string>('ALL');
  const [exposure, setExposure] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  // Graph Data state
  const [graphData, setGraphData] = useState<CryptoGraphResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Blast Radius Simulator state
  const currentYear = new Date().getFullYear();
  const [quantumArrivalYear, setQuantumArrivalYear] = useState<number>(currentYear + 5);
  const [blastRadiusProjections, setBlastRadiusProjections] = useState<Array<{id: string, status: string, margin?: number}> | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Evidence Drawer state
  const [evidenceDrawer, setEvidenceDrawer] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    evidenceIds: string[];
  }>({
    isOpen: false,
    title: '',
    evidenceIds: [],
  });

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getCryptoGraph({
        scanId: selectedScanId && selectedScanId !== 'all' ? selectedScanId : undefined,
        severity,
        owner,
        environment,
        algorithm,
        pqcReadiness,
        exposure,
        search: searchTerm,
      });
      setGraphData(res);
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to load crypto graph.');
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, severity, owner, environment, algorithm, pqcReadiness, exposure, searchTerm]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleResetFilters = () => {
    setSeverity('ALL');
    setOwner('ALL');
    setEnvironment('ALL');
    setAlgorithm('ALL');
    setPqcReadiness('ALL');
    setExposure('ALL');
    setSearchTerm('');
    setBlastRadiusProjections(null);
  };

  const simulateBlastRadius = async () => {
    setIsSimulating(true);
    try {
      const res = await api.getBlastRadius({
        scanId: selectedScanId && selectedScanId !== 'all' ? selectedScanId : undefined,
        quantumArrivalYear,
      });
      setBlastRadiusProjections(res.projection);
    } catch (err: unknown) {
      console.error(err);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleOpenEvidence = (title: string, subtitle: string, evidenceIds: string[]) => {
    setEvidenceDrawer({
      isOpen: true,
      title,
      subtitle,
      evidenceIds: evidenceIds.length > 0 ? evidenceIds : Object.keys(graphData?.evidence_lookup || {}).slice(0, 3),
    });
  };

  const handleCloseEvidence = () => {
    setEvidenceDrawer((prev) => ({ ...prev, isOpen: false }));
  };

  const metadata: GraphFilterMetadata = graphData?.filter_metadata || {
    severities: ['Critical', 'High', 'Medium', 'Low', 'Informational'],
    owners: [],
    environments: [],
    algorithms: [],
    pqc_statuses: [],
    exposures: [],
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header bar */}
      <div className="glass-card p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-cyan-400 font-semibold">
              Interactive Cryptographic Topology
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">
            Cryptographic Dependency Graph
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Trace end-to-end cryptographic lineage: Application &rarr; Service &rarr; Certificate &rarr; Protocol &rarr; Algorithm &rarr; Data.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchGraph()}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-slate-700 transition-colors"
            title="Refresh Graph"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
          <button
            onClick={handleResetFilters}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 inline-flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Filters</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar (Severity, Owner, Environment, Algorithm, PQC Readiness, Exposure) */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/70 pb-2.5">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-cyan-400 transition-colors"
          >
            <Filter className={`w-4 h-4 ${showFilters ? 'text-cyan-400' : 'text-slate-400'}`} />
            <span>{showFilters ? 'Hide Advanced Filters' : 'Topology & Blast Radius Filters'}</span>
          </button>
          <span className="text-[11px] text-slate-500 font-mono">
            {graphData ? `${graphData.graph.total_nodes} of ${graphData.graph.unfiltered_nodes_count} Nodes Visible` : 'Loading...'}
          </span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs pb-2 border-b border-slate-800/50">
          {/* Severity */}
          <div>
            <label htmlFor="filter-severity" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              Severity
            </label>
            <select
              id="filter-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Severities</option>
              {metadata.severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Owner */}
          <div>
            <label htmlFor="filter-owner" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              Owner
            </label>
            <select
              id="filter-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Owners</option>
              {metadata.owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          {/* Environment */}
          <div>
            <label htmlFor="filter-environment" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              Environment
            </label>
            <select
              id="filter-environment"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Environments</option>
              {metadata.environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </select>
          </div>

          {/* Algorithm */}
          <div>
            <label htmlFor="filter-algorithm" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              Algorithm
            </label>
            <select
              id="filter-algorithm"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Algorithms</option>
              {metadata.algorithms.map((algo) => (
                <option key={algo} value={algo}>
                  {algo}
                </option>
              ))}
            </select>
          </div>

          {/* PQC Readiness */}
          <div>
            <label htmlFor="filter-pqc-readiness" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              PQC Readiness
            </label>
            <select
              id="filter-pqc-readiness"
              value={pqcReadiness}
              onChange={(e) => setPqcReadiness(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Horizons</option>
              {metadata.pqc_statuses.map((pqc) => (
                <option key={pqc} value={pqc}>
                  {pqc}
                </option>
              ))}
            </select>
          </div>

          {/* Exposure */}
          <div>
            <label htmlFor="filter-exposure" className="text-[10px] uppercase font-mono text-slate-400 block mb-1">
              Exposure
            </label>
            <select
              id="filter-exposure"
              value={exposure}
              onChange={(e) => setExposure(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
            >
              <option value="ALL">All Exposures</option>
              {metadata.exposures.map((exp) => (
                <option key={exp} value={exp}>
                  {exp}
                </option>
              ))}
            </select>
          </div>
          </div>
        )}

        {/* Blast Radius Simulator Control */}
        <div className="flex items-center gap-4 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
          <div className="flex-1 max-w-sm">
            <label htmlFor="blast-radius-slider" className="text-xs font-semibold text-rose-400 flex justify-between mb-2">
              <span>Simulated Quantum Arrival Year</span>
              <span className="font-mono bg-rose-500/20 px-2 rounded">{quantumArrivalYear}</span>
            </label>
            <input
              id="blast-radius-slider"
              type="range"
              min={currentYear}
              max={currentYear + 20}
              value={quantumArrivalYear}
              onChange={(e) => setQuantumArrivalYear(parseInt(e.target.value, 10))}
              className="w-full accent-rose-500"
            />
          </div>
          <button
            onClick={simulateBlastRadius}
            disabled={isSimulating}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow border border-rose-500 transition-colors flex items-center gap-2"
          >
            {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
            Simulate Blast Radius
          </button>
          {blastRadiusProjections && (
            <button
              onClick={() => setBlastRadiusProjections(null)}
              className="px-3 py-2 text-slate-400 hover:text-slate-200 text-xs font-semibold"
            >
              Clear Simulation
            </button>
          )}
        </div>

        {/* Search row */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            id="filter-search"
            type="text"
            placeholder="Search nodes by label, service name, algorithm, or asset identifier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* Main Canvas Area */}
      {loading && !graphData ? (
        <div className="glass-card p-16 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-slate-200">
            Synthesizing Cryptographic Relationship Topology...
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            Traversing dependency pipelines from Applications to Sensitive Data.
          </p>
        </div>
      ) : error ? (
        <div className="glass-card p-8 border-rose-800 bg-rose-950/20 text-center">
          <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
          <h3 className="text-base font-bold text-rose-200">Graph Construction Error</h3>
          <p className="text-xs text-rose-300 mt-1">{error}</p>
          <button
            onClick={() => fetchGraph()}
            className="mt-4 px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-900 hover:bg-rose-800 text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : graphData ? (
        <CryptoGraphCanvas
          nodes={graphData.graph.nodes}
          edges={graphData.graph.edges}
          evidenceLookup={graphData.evidence_lookup}
          blastRadiusProjections={blastRadiusProjections}
          onOpenEvidence={handleOpenEvidence}
        />
      ) : null}

      {/* Slide-over Evidence Drawer */}
      <EvidenceDrawer
        isOpen={evidenceDrawer.isOpen}
        title={evidenceDrawer.title}
        subtitle={evidenceDrawer.subtitle}
        evidenceIds={evidenceDrawer.evidenceIds}
        evidenceLookup={graphData?.evidence_lookup || {}}
        onClose={handleCloseEvidence}
      />
    </div>
  );
};
