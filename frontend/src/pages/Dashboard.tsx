import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import {
  Shield,
  Layers,
  Code2,
  Globe,
  PackageCheck,
  AlertTriangle,
  Play,
  FileJson,
  Sparkles,
  Download,
  Copy,
  Check,
  X,
  ExternalLink,
  Loader2,
  CheckCircle2,
  FileText,
  Sliders,
  Upload,
  RefreshCw,
  Cpu,
  GitBranch,
  Archive,
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardSummary } from '../types';
import { MetricCard } from '../components/MetricCard';
import { MoscaTable } from '../components/MoscaTable';

export const Dashboard: React.FC = () => {
  const outlet = useOutletContext<{ selectedScanId?: string; onUploadSuccess?: (id: string) => void }>() || {};
  const selectedScanId = outlet.selectedScanId;

  // Configuration state
  const [targetType, setTargetType] = useState<'static' | 'network' | 'binary'>('static');
  
  // Static Code Scanner state
  const [staticMode, setStaticMode] = useState<'upload' | 'git'>('upload');
  const [staticZipFile, setStaticZipFile] = useState<File | null>(null);
  const [staticFiles, setStaticFiles] = useState<File[]>([]);
  const [gitUrl, setGitUrl] = useState<string>('');
  
  // Network Endpoint Scanner state
  const [networkTarget, setNetworkTarget] = useState<string>('');
  
  // Binary / Container Scanner state
  const [binaryMode, setBinaryMode] = useState<'upload' | 'image'>('upload');
  const [binaryFile, setBinaryFile] = useState<File | null>(null);
  const [containerImage, setContainerImage] = useState<string>('');

  const [selectedPolicy, setSelectedPolicy] = useState<string>('regulated_bfsi');
  const [selectedScenario, setSelectedScenario] = useState<string>('baseline');

  // Telemetry data state
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scanner pipeline execution state
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [mergedCbomModal, setMergedCbomModal] = useState<string | null>(null);
  const [pqcModal, setPqcModal] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchSummary = useCallback(async (overrideScanId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const activeId = overrideScanId !== undefined ? overrideScanId : selectedScanId;
      const res = await api.getDashboardSummary(
        activeId && activeId !== 'all' ? activeId : undefined,
        selectedPolicy || undefined,
        selectedScenario || undefined
      );
      setData(res);
      if (res.policy_profile && !selectedPolicy) {
        setSelectedPolicy(res.policy_profile);
      }
      if (res.scenario && !selectedScenario) {
        setSelectedScenario(res.scenario);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to connect to backend.');
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedPolicy, selectedScenario]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Primary Scan Execution Trigger
  const handleExecuteScan = async () => {
    setRunningAction(targetType);
    setActionFeedback(null);

    try {
      let res: any;
      if (targetType === 'static') {
        if (staticMode === 'git') {
          if (!gitUrl.trim()) throw new Error('Please provide a Git repository URL (e.g. https://github.com/org/repo.git)');
          res = await api.triggerStaticScan(undefined, {
            github_url: gitUrl.trim(),
            policy_profile: selectedPolicy,
            scenario: selectedScenario,
          });
        } else {
          if (staticZipFile) {
            res = await api.triggerStaticScan(staticZipFile, {
              policy_profile: selectedPolicy,
              scenario: selectedScenario,
            });
          } else if (staticFiles.length > 0) {
            res = await api.triggerStaticScan(staticFiles, {
              policy_profile: selectedPolicy,
              scenario: selectedScenario,
            });
          } else {
            throw new Error('Please select a project .ZIP archive or enter a Git repository URL.');
          }
        }
        setActionFeedback({
          type: 'success',
          message: `Static code scan completed. Identified ${res.metrics?.total_assets ?? 0} cryptographic assets.`
        });
      } else if (targetType === 'network') {
        const target = networkTarget.trim();
        if (!target) throw new Error('Please enter a target URL or hostname (e.g. https://api.yourdomain.com or 192.168.1.1)');
        res = await api.triggerNetworkScan(target, undefined, {
          policy_profile: selectedPolicy,
          scenario: selectedScenario,
        });
        setActionFeedback({
          type: 'success',
          message: `Network probe of ${target} completed successfully.`
        });
      } else if (targetType === 'binary') {
        if (binaryMode === 'upload') {
          if (!binaryFile) throw new Error('Please select a binary archive (.zip, .jar, .so, etc.) to scan.');
          res = await api.triggerBinaryScan(binaryFile, {
            policy_profile: selectedPolicy,
            scenario: selectedScenario,
          });
        } else if (binaryMode === 'image') {
          const img = containerImage.trim();
          if (!img) throw new Error('Please enter a container image tag (e.g. nginx:alpine)');
          res = await api.triggerBinaryScan(undefined, {
            image: img,
            policy_profile: selectedPolicy,
            scenario: selectedScenario,
          });
        }
        setActionFeedback({
          type: 'success',
          message: `Container & binary package analysis completed.`
        });
      }

      if (res?.scan_id && outlet.onUploadSuccess) {
        outlet.onUploadSuccess(res.scan_id);
      }
      await fetchSummary(res?.scan_id);
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err.message || `Scan failed to execute.`
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleMergeCboms = async () => {
    setRunningAction('merge');
    setActionFeedback(null);
    try {
      const res = await api.mergeCboms([], {
        policy_profile: selectedPolicy,
        scenario: selectedScenario,
      });
      setActionFeedback({
        type: 'success',
        message: `Unified ${res.total_merged_components} components into CycloneDX 1.6 CBOM.`
      });
      await fetchSummary();
      if (outlet.onUploadSuccess) outlet.onUploadSuccess(res.scan_id);
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: `Merge failed: ${err.message}` });
    } finally {
      setRunningAction(null);
    }
  };

  const handleOpenMergedCbom = async () => {
    setRunningAction('view_cbom');
    try {
      const cbom = await api.getMergedCbom();
      setMergedCbomModal(JSON.stringify(cbom, null, 2));
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: `Could not load CBOM: ${err.message}` });
    } finally {
      setRunningAction(null);
    }
  };

  const handleOpenPqcReport = async () => {
    setRunningAction('view_pqc');
    try {
      const report = await api.getPqcReport();
      setPqcModal(report);
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: `Could not load PQC report: ${err.message}` });
    } finally {
      setRunningAction(null);
    }
  };

  const metrics = data?.metrics || {
    total_assets: 0,
    total_findings: 0,
    critical_findings: 0,
    assets_at_quantum_risk: 0,
    assets_at_risk: 0,
    assets_critical_urgent: 0,
    unknown_posture_percentage: 0,
    severity_counts: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
    mosca_status_counts: { SAFE: 0, WATCH: 0, AT_RISK: 0, CRITICAL_URGENT: 0 },
    overall_cicd_pass: true,
  };

  const hasScans = Boolean(data?.scan_id && metrics.total_assets > 0);
  const totalAtRisk =
    (metrics.assets_at_risk ?? metrics.mosca_status_counts.AT_RISK) +
    (metrics.assets_critical_urgent ?? metrics.mosca_status_counts.CRITICAL_URGENT);

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* 1. TARGET & SCAN DISCOVERY HUB */}
      <div className="bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="space-y-5 relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <h1 className="text-lg md:text-xl font-bold text-white flex items-center gap-2.5">
                <Shield className="w-5 h-5 text-cyan-400" />
                Cryptographic Discovery & Quantum Risk Engine
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Enter your repository path, network address, or container target to scan and generate an authentic CycloneDX 1.6 CBOM.
              </p>
            </div>

            {/* Scenario & Policy Selectors */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-2xs font-mono text-slate-400 uppercase">Scenario:</span>
                <select
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value)}
                  className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="optimistic" className="bg-slate-900">Optimistic (2036 / Z=12y)</option>
                  <option value="baseline" className="bg-slate-900">Baseline (2031 / Z=9y)</option>
                  <option value="conservative" className="bg-slate-900">Conservative (2028 / Z=6y)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1">
                <span className="text-2xs font-mono text-slate-400 uppercase">Policy:</span>
                <select
                  value={selectedPolicy}
                  onChange={(e) => setSelectedPolicy(e.target.value)}
                  className="bg-transparent text-xs font-mono text-slate-200 focus:outline-none cursor-pointer"
                >
                  <option value="regulated_bfsi" className="bg-slate-900">Regulated BFSI</option>
                  <option value="cnsa_2_0" className="bg-slate-900">CNSA 2.0</option>
                  <option value="nist_pqc_2024" className="bg-slate-900">NIST PQC 2024</option>
                  <option value="internal_enterprise" className="bg-slate-900">Internal Enterprise</option>
                </select>
              </div>
            </div>
          </div>

          {/* Target Selection Tabs */}
          <div className="flex gap-2 border-b border-slate-800/60 pb-3">
            <button
              onClick={() => { setTargetType('static'); setActionFeedback(null); }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                targetType === 'static'
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                  : 'bg-slate-950/40 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-4 h-4" />
              <span>Source Repository</span>
            </button>

            <button
              onClick={() => { setTargetType('network'); setActionFeedback(null); }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                targetType === 'network'
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                  : 'bg-slate-950/40 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>Network Endpoint</span>
            </button>

            <button
              onClick={() => { setTargetType('binary'); setActionFeedback(null); }}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all ${
                targetType === 'binary'
                  ? 'bg-blue-500/15 text-blue-300 border border-blue-500/40 shadow-sm shadow-blue-500/10'
                  : 'bg-slate-950/40 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              <PackageCheck className="w-4 h-4" />
              <span>Container / Library</span>
            </button>
          </div>

          {/* Target Input Controls */}
          <div className="space-y-4">
            {targetType === 'static' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setStaticMode('upload')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                        staticMode === 'upload'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Upload ZIP / Project Folder</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setStaticMode('git')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                        staticMode === 'git'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      <span>Git Repository URL</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-8">
                    {staticMode === 'upload' ? (
                      <div className="relative flex items-center">
                        <label className="w-full flex items-center justify-between bg-slate-950 border border-dashed border-slate-700 hover:border-cyan-500/60 rounded-xl px-4 py-2.5 text-xs text-slate-300 cursor-pointer transition-colors group">
                          <div className="flex items-center gap-2.5 truncate">
                            <Upload className="w-4 h-4 text-cyan-400 shrink-0 group-hover:scale-110 transition-transform" />
                            {staticZipFile ? (
                              <span className="font-mono text-cyan-300 truncate">
                                {staticZipFile.name} ({(staticZipFile.size / (1024 * 1024)).toFixed(2)} MB)
                              </span>
                            ) : staticFiles.length > 0 ? (
                              <span className="font-mono text-cyan-300 truncate">
                                {staticFiles.length} file(s) selected
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                Click or drop project <strong className="text-slate-200 font-semibold">.ZIP archive</strong> or source files here
                              </span>
                            )}
                          </div>
                          <span className="text-2xs bg-slate-800 text-slate-300 px-2 py-1 rounded-md border border-slate-700 font-medium shrink-0 ml-2">
                            Browse Files
                          </span>
                          <input
                            type="file"
                            accept=".zip,.c,.h,.cpp,.hpp,.go,.js,.mjs,.cjs,.py"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files.length > 0) {
                                const filesArray = Array.from(e.target.files);
                                const zip = filesArray.find((f) => f.name.toLowerCase().endsWith('.zip'));
                                if (zip) {
                                  setStaticZipFile(zip);
                                  setStaticFiles([]);
                                } else {
                                  setStaticFiles(filesArray);
                                  setStaticZipFile(null);
                                }
                              }
                            }}
                          />
                        </label>
                        {(staticZipFile || staticFiles.length > 0) && (
                          <button
                            type="button"
                            onClick={() => { setStaticZipFile(null); setStaticFiles([]); }}
                            className="absolute right-24 p-1 text-slate-400 hover:text-rose-400"
                            title="Clear selection"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="relative flex items-center">
                          <GitBranch className="w-4 h-4 text-cyan-400 absolute left-3 pointer-events-none" />
                          <input
                            type="text"
                            value={gitUrl}
                            onChange={(e) => setGitUrl(e.target.value)}
                            placeholder="e.g. https://github.com/org/repo.git"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-4 flex items-end">
                    <button
                      onClick={handleExecuteScan}
                      disabled={runningAction !== null}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-bold text-xs transition-all shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {runningAction === 'static' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 fill-slate-950" />
                      )}
                      <span>
                        {runningAction === 'static'
                          ? (staticMode === 'git' ? 'Cloning & Analyzing...' : 'Unpacking & Scanning...')
                          : 'Scan Source Code'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {targetType === 'network' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-8 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-2xs font-mono text-slate-400">
                      <span>Target Endpoint URL or Domain:</span>
                    </div>
                    <div className="relative flex items-center">
                      <Globe className="w-4 h-4 text-emerald-400 absolute left-3 pointer-events-none" />
                      <input
                        type="text"
                        value={networkTarget}
                        onChange={(e) => setNetworkTarget(e.target.value)}
                        placeholder="e.g. https://api.yourdomain.com or 192.168.1.1"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-4 flex items-end">
                    <button
                      onClick={handleExecuteScan}
                      disabled={runningAction !== null}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs transition-all shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {runningAction === 'network' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 fill-slate-950" />
                      )}
                      <span>{runningAction === 'network' ? 'Probing TLS / SSH...' : 'Probe Network Endpoint'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {targetType === 'binary' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex rounded-lg bg-slate-950 p-1 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setBinaryMode('upload')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                        binaryMode === 'upload'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Binaries / ZIP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBinaryMode('image')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                        binaryMode === 'image'
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <PackageCheck className="w-3.5 h-3.5" />
                      <span>Container Image</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                  <div className="md:col-span-8">
                    {binaryMode === 'upload' ? (
                      <div className="relative flex items-center">
                        <label className="w-full flex items-center justify-between bg-slate-950 border border-dashed border-slate-700 hover:border-blue-500/60 rounded-xl px-4 py-2.5 text-xs text-slate-300 cursor-pointer transition-colors group">
                          <div className="flex items-center gap-2.5 truncate">
                            <Upload className="w-4 h-4 text-blue-400 shrink-0 group-hover:scale-110 transition-transform" />
                            {binaryFile ? (
                              <span className="font-mono text-blue-300 truncate">
                                {binaryFile.name} ({(binaryFile.size / (1024 * 1024)).toFixed(2)} MB)
                              </span>
                            ) : (
                              <span className="text-slate-400">
                                Click or drop <strong className="text-slate-200 font-semibold">.ZIP, .jar, .so, .dll, or binary executable</strong>
                              </span>
                            )}
                          </div>
                          <span className="text-2xs bg-slate-800 text-slate-300 px-2 py-1 rounded-md border border-slate-700 font-medium shrink-0 ml-2">
                            Browse Binary
                          </span>
                          <input
                            type="file"
                            accept=".zip,.jar,.tar,.so,.dll,.exe,.bin"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                setBinaryFile(e.target.files[0]);
                              }
                            }}
                          />
                        </label>
                        {binaryFile && (
                          <button
                            type="button"
                            onClick={() => setBinaryFile(null)}
                            className="absolute right-28 p-1 text-slate-400 hover:text-rose-400"
                            title="Clear selection"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="relative flex items-center">
                          <PackageCheck className="w-4 h-4 text-blue-400 absolute left-3 pointer-events-none" />
                          <input
                            type="text"
                            value={containerImage}
                            onChange={(e) => setContainerImage(e.target.value)}
                            placeholder="e.g. your-org/app:latest"
                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-4 flex items-end">
                    <button
                      onClick={handleExecuteScan}
                      disabled={runningAction !== null}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500 text-slate-950 font-bold text-xs transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {runningAction === 'binary' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Play className="w-4 h-4 fill-slate-950" />
                      )}
                      <span>{runningAction === 'binary' ? 'Inventorying Packages...' : 'Scan Binary / Container'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Real-time Execution Feedback */}
          {actionFeedback && (
            <div
              className={`p-3 rounded-xl flex items-center justify-between gap-3 text-xs font-medium border animate-in fade-in duration-200 ${
                actionFeedback.type === 'success'
                  ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
                  : actionFeedback.type === 'error'
                  ? 'bg-rose-950/40 text-rose-300 border-rose-800/60'
                  : 'bg-cyan-950/40 text-cyan-300 border-cyan-800/60'
              }`}
            >
              <div className="flex items-center gap-2">
                {actionFeedback.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{actionFeedback.message}</span>
              </div>
              <button
                onClick={() => setActionFeedback(null)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {error && !actionFeedback && (
            <div className="p-3 rounded-xl flex items-center justify-between gap-3 text-xs font-medium border bg-amber-950/40 text-amber-300 border-amber-800/60">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Notice: {error}</span>
              </div>
              <button onClick={() => setError(null)} className="text-slate-400 hover:text-white p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. RESULTS VIEW (EMPTY STATE VS LIVE SCAN RESULTS) */}
      {!hasScans ? (
        <div className="bg-slate-900/40 border border-dashed border-slate-800/80 rounded-2xl p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto">
            <Shield className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-base font-bold text-white">No Active Cryptographic Inventory</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              Zero mock data loaded. Enter your repository path, network endpoint, or upload files above and run a scan to generate your CycloneDX 1.6 Cryptographic Bill of Materials (CBOM) and quantum posture.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Posture Banner */}
          <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900/90 to-slate-950 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                  Active Scan Verdict
                </span>
                <span className="text-2xs font-mono text-slate-500">{data?.scan_name || 'Current Session'}</span>
              </div>
              <h2 className="text-lg font-bold text-white">
                Quantum readiness posture:{' '}
                <span className={totalAtRisk > 0 ? 'text-amber-400 font-mono' : 'text-emerald-400 font-mono'}>
                  {totalAtRisk} asset{totalAtRisk === 1 ? '' : 's'} at risk
                </span>{' '}
                under Mosca {selectedScenario} model.
              </h2>
            </div>

            {/* Pipeline Action Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleMergeCboms}
                disabled={runningAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Merge CBOMs</span>
              </button>

              <button
                onClick={handleOpenMergedCbom}
                disabled={runningAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <FileJson className="w-3.5 h-3.5 text-cyan-400" />
                <span>View CBOM JSON</span>
              </button>

              <button
                onClick={handleOpenPqcReport}
                disabled={runningAction !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600/25 hover:bg-violet-600/35 text-violet-300 border border-violet-500/30 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <FileText className="w-3.5 h-3.5 text-violet-400" />
                <span>PQC Report</span>
              </button>

              <button
                onClick={() => fetchSummary()}
                disabled={loading}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                title="Refresh telemetry"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
              </button>
            </div>
          </div>

          {/* 4 Focused Executive KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total Cryptographic Assets"
              value={metrics.total_assets}
              subtitle="Ciphers, algorithms & protocols"
              icon={<Layers className="w-5 h-5 text-cyan-400" />}
              variant="cyan"
            />
            <MetricCard
              title="Assets at Quantum Risk"
              value={totalAtRisk}
              subtitle="Exposed before migration (X+Y > Z)"
              icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
              variant="amber"
            />
            <MetricCard
              title="Critical Classical Weaknesses"
              value={metrics.critical_findings ?? metrics.severity_counts.critical}
              subtitle="Broken primitives (MD5, SHA1, DES)"
              icon={<Shield className="w-5 h-5 text-rose-400" />}
              variant="rose"
            />
            <MetricCard
              title="Post-Quantum Readiness"
              value={`${Math.round(100 - (metrics.unknown_posture_percentage ?? 0))}%`}
              subtitle="Quantified crypto inventory coverage"
              icon={<Cpu className="w-5 h-5 text-emerald-400" />}
              variant="emerald"
            />
          </div>

          {/* Mosca Calculus Table */}
          {data?.mosca_analysis_table && data.mosca_analysis_table.length > 0 && (
            <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white">Mosca Theorem Calculus Breakdown</h3>
                  <p className="text-xs text-slate-400">
                    Calculated as ($X + Y &gt; Z$): Confidentiality life ($X$) + Migration time ($Y$) vs CRQC Horizon ($Z$).
                  </p>
                </div>
                <Link
                  to="/assets"
                  className="text-xs font-semibold text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <span>Explore Assets Explorer</span>
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              <MoscaTable rows={data.mosca_analysis_table} scanId={data?.scan_id || undefined} />
            </div>
          )}
        </div>
      )}

      {/* 3. MODALS */}
      {/* CBOM JSON Viewer Modal */}
      {mergedCbomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <FileJson className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">CycloneDX 1.6 Cryptographic Bill of Materials</h3>
                  <p className="text-2xs text-slate-400 font-mono">Live scanner inventory manifest</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(mergedCbomModal);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
                </button>

                <button
                  onClick={() => {
                    const blob = new Blob([mergedCbomModal], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `cbom_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download CBOM</span>
                </button>

                <button onClick={() => setMergedCbomModal(null)} className="p-1.5 text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto bg-slate-950 font-mono text-2xs text-cyan-300 leading-relaxed">
              <pre className="whitespace-pre-wrap">{mergedCbomModal}</pre>
            </div>
          </div>
        </div>
      )}

      {/* PQC Report Modal */}
      {pqcModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="max-w-3xl w-full bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-violet-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">Post-Quantum Cryptography Migration Plan</h3>
                  <p className="text-2xs text-slate-400 font-mono">
                    Policy: {pqcModal.policy_profile || 'regulated_bfsi'} • Scenario: {pqcModal.scenario || 'baseline'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(pqcModal, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `pqc_report_${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download JSON</span>
                </button>

                <Link
                  to="/reports"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Full Reports</span>
                </Link>

                <button onClick={() => setPqcModal(null)} className="p-1.5 text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto space-y-4">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-2xs font-mono uppercase text-violet-400 font-bold tracking-wider block">
                  Recommended Sequence of Action
                </span>
                <ol className="text-xs text-slate-300 space-y-1.5 list-decimal list-inside font-sans">
                  <li><span className="text-rose-400 font-semibold">Phase 1:</span> Eliminate classically broken algorithms (MD5, SHA-1, DES).</li>
                  <li><span className="text-amber-400 font-semibold">Phase 2:</span> Upgrade network transport protocols to TLS 1.3 / SSH Modern.</li>
                  <li><span className="text-yellow-400 font-semibold">Phase 3:</span> Identify long-lived data assets vulnerable to "Harvest Now, Decrypt Later".</li>
                  <li><span className="text-cyan-400 font-semibold">Phase 4:</span> Pilot hybrid key exchange (X25519 + ML-KEM-768).</li>
                  <li><span className="text-emerald-400 font-semibold">Phase 5:</span> Deploy standardized FIPS 203 / 204 PQC algorithms.</li>
                </ol>
              </div>

              <div className="space-y-2.5">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Identified Recommendations ({pqcModal.recommendations?.length || 0})
                </h4>
                {(!pqcModal.recommendations || pqcModal.recommendations.length === 0) ? (
                  <p className="text-xs text-slate-500 italic">No specific recommendations recorded.</p>
                ) : (
                  pqcModal.recommendations.map((rec: any, idx: number) => (
                    <div key={idx} className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-cyan-300 font-semibold">{rec.recommended_target}</span>
                        <span className="text-2xs font-mono uppercase px-2 py-0.5 rounded bg-violet-950 text-violet-300 border border-violet-800 font-bold">
                          {rec.priority || 'High'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">{rec.current_state}</p>
                      {rec.pqc_migration && (
                        <p className="text-xs text-violet-300"><span className="text-violet-400 font-semibold">PQC Path:</span> {rec.pqc_migration}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
