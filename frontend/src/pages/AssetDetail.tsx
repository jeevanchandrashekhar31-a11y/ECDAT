import React, { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Shield,
  AlertTriangle,
  Zap,
  CheckCircle2,
  XCircle,
  FileCode,
  Layers,
  Copy,
  Check,
  Cpu,
  BookOpen,
  Sparkles,
  FileCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { AssetDetail as IAssetDetail } from '../types';
import { SeverityBadge, MoscaStatusBadge } from '../components/SeverityBadge';
import { MoscaTimeline } from '../components/MoscaTimeline';

export const AssetDetail: React.FC = () => {
  const { assetId } = useParams<{ assetId: string }>();
  const [searchParams] = useSearchParams();
  const scanId = searchParams.get('scanId') || undefined;

  const [asset, setAsset] = useState<IAssetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sub-inventory categorization tab
  const [inventoryTab, setInventoryTab] = useState<'all' | 'certs' | 'protocols' | 'code'>('all');

  useEffect(() => {
    if (!assetId) return;

    let mounted = true;
    const fetchAsset = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getAssetById(assetId, scanId);
        if (mounted) {
          setAsset(data);
        }
      } catch (err: unknown) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to load asset details';
          setError(message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchAsset();

    return () => {
      mounted = false;
    };
  }, [assetId, scanId]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter evidence based on active category tab
  const filteredEvidence = (asset?.evidence || []).filter((item) => {
    if (inventoryTab === 'all') return true;
    const cat = (item.category || '').toLowerCase();
    const alg = (item.algorithm || '').toLowerCase();
    const loc = (item.location || '').toLowerCase();

    if (inventoryTab === 'certs') {
      return cat.includes('cert') || cat.includes('x509') || alg.includes('rsa') || alg.includes('ecdsa');
    }
    if (inventoryTab === 'protocols') {
      return (
        cat.includes('protocol') ||
        cat.includes('tls') ||
        cat.includes('ssh') ||
        loc.includes('port') ||
        loc.includes('cipher')
      );
    }
    if (inventoryTab === 'code') {
      return (
        cat.includes('code') ||
        cat.includes('call') ||
        item.line_number !== undefined ||
        loc.includes('/') ||
        loc.includes('\\')
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-36 bg-slate-800 animate-pulse rounded"></div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 h-44 animate-pulse"></div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 h-64 animate-pulse"></div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 h-64 animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="space-y-6">
        <Link
          to="/assets"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Asset Inventory
        </Link>
        <div className="p-8 rounded-xl bg-red-950/20 border border-red-900/40 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
          <h2 className="text-xl font-semibold text-white">Asset Not Found or Telemetry Query Failed</h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {error || 'Unable to retrieve cryptographic telemetry for this asset.'}
          </p>
          <div className="pt-2">
            <Link
              to="/assets"
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Return to Cryptographic Inventory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* 1. Breadcrumb & Zero-Secret Verification Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/assets"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-cyan-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Cryptographic Asset Inventory
        </Link>

        {/* Zero Secret Literals Security Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/60 text-emerald-300 text-xs font-mono">
          <FileCheck className="w-3.5 h-3.5 text-emerald-400" />
          <span>Zero Secret Literals Verified — Redaction Engine Active</span>
        </div>
      </div>

      {/* 2. Asset Hero Card & Explainable Story */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800/80 rounded-2xl p-6 md:p-8 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

        <div className="space-y-6 relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-2.5 py-1 bg-cyan-950/60 border border-cyan-800/50 text-cyan-400 rounded-md uppercase tracking-wider font-semibold">
                  {asset.asset_type.replace(/_/g, ' ')}
                </span>
                {asset.policy_profile && (
                  <span className="text-xs font-mono px-2.5 py-1 bg-slate-800 text-slate-300 rounded-md border border-slate-700">
                    Policy: {asset.policy_profile}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tight break-all">
                  {asset.primary_identifier}
                </h1>
                <button
                  onClick={() => copyToClipboard(asset.primary_identifier)}
                  title="Copy identifier"
                  className="p-1.5 text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700/80 rounded-lg transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Status & Risk Badges */}
            <div className="flex flex-wrap items-center gap-2.5">
              <SeverityBadge severity={asset.highest_severity} />
              <MoscaStatusBadge status={asset.mosca?.status || 'SAFE'} />

              {asset.at_quantum_risk ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-950/70 text-rose-300 border border-rose-800/60">
                  <Zap className="w-3.5 h-3.5 text-rose-400" />
                  Quantum Vulnerable (SNDL)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950/70 text-emerald-300 border border-emerald-800/60">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  Quantum Resistant
                </span>
              )}

              {asset.cicd_pass ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  CI/CD Gate Passed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-rose-950/40 text-rose-300 border border-rose-800/40">
                  <XCircle className="w-3.5 h-3.5" />
                  CI/CD Gate Blocked
                </span>
              )}
            </div>
          </div>

          {/* Explainable Executive Narrative Story */}
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
              <Sparkles className="w-4 h-4" />
              <span>Explainable Asset Risk Story</span>
            </div>
            <p className="text-xs md:text-sm text-slate-200 leading-relaxed font-sans">
              Asset <span className="font-mono text-cyan-300 font-semibold">{asset.primary_identifier}</span> is
              classified as a <strong className="text-white capitalize">{asset.asset_type.replace(/_/g, ' ')}</strong>{' '}
              containing{' '}
              <strong className="text-white">{asset.evidence?.length || 0} cryptographic primitive(s)</strong>.
              {asset.at_quantum_risk ? (
                <>
                  {' '}
                  It is vulnerable to <strong>Store Now, Decrypt Later (SNDL)</strong> attacks under the active Mosca
                  scenario because confidential data with a {asset.mosca?.shelf_life_X || 5}-year shelf life will remain
                  exposed when cryptanalytically relevant quantum computers emerge.
                </>
              ) : (
                <>
                  {' '}
                  It currently satisfies cryptographic policy safety requirements without immediate quantum deficit
                  windows.
                </>
              )}
            </p>
          </div>

          {/* Quick Telemetry Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-slate-800/60">
            <div>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Data Sensitivity</p>
              <p className="text-sm font-semibold text-slate-200 capitalize mt-0.5">
                {asset.data_sensitivity || 'Standard'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Business Criticality</p>
              <p className="text-sm font-semibold text-slate-200 capitalize mt-0.5">
                {asset.business_criticality || 'Standard'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Discovered Primitives</p>
              <p className="text-sm font-semibold text-cyan-400 font-mono mt-0.5">
                {asset.evidence?.length || 0} Component{asset.evidence?.length === 1 ? '' : 's'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">Scan Reference</p>
              <p className="text-xs font-mono text-slate-400 truncate mt-1">
                {asset.scan_id ? asset.scan_id.slice(0, 16) : 'Active Scan'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Interactive Mosca Visualization Timeline & What-If Modeler */}
      {asset.mosca && (
        <MoscaTimeline
          initialX={asset.mosca.shelf_life_X}
          initialY={asset.mosca.migration_time_Y}
          initialZ={asset.mosca.quantum_threat_Z}
          initialSensitivity={asset.data_sensitivity}
          initialScenario="baseline"
          initialStatus={asset.mosca.status}
          assetIdentifier={asset.primary_identifier}
          policyProfile={asset.policy_profile}
        />
      )}

      {/* 4. Two-Column Layout: Evidence / Findings vs Remediation Roadmap */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Inventory Evidence & Findings List (7 cols) */}
        <div className="lg:col-span-7 space-y-8">
          {/* Categorized Crypto Inventory Section */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Cryptographic Inventory Evidence</h3>
              </div>

              {/* Sub-Category Filter Tabs (Certificates / Protocols / Code) */}
              <div className="flex items-center p-0.5 bg-slate-950 border border-slate-800 rounded-lg text-xs">
                <button
                  onClick={() => setInventoryTab('all')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    inventoryTab === 'all' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({asset.evidence?.length || 0})
                </button>
                <button
                  onClick={() => setInventoryTab('certs')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    inventoryTab === 'certs'
                      ? 'bg-slate-800 text-white font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Certificates
                </button>
                <button
                  onClick={() => setInventoryTab('protocols')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    inventoryTab === 'protocols'
                      ? 'bg-slate-800 text-white font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Protocols
                </button>
                <button
                  onClick={() => setInventoryTab('code')}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    inventoryTab === 'code'
                      ? 'bg-slate-800 text-white font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Source Code
                </button>
              </div>
            </div>

            {filteredEvidence.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px]">
                      <th className="pb-3 pr-3">Algorithm &amp; Key Size</th>
                      <th className="pb-3 pr-3">Category</th>
                      <th className="pb-3 pr-3">Location / Target</th>
                      <th className="pb-3 text-right">Confidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-sans">
                    {filteredEvidence.map((item, idx) => (
                      <tr key={item.finding_id || idx} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 pr-3">
                          <div className="font-mono font-bold text-white flex items-center gap-2">
                            <span>{item.algorithm}</span>
                            {item.key_size && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 border border-slate-700">
                                {item.key_size} bit
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 pr-3 text-slate-300 capitalize">
                          {item.category || 'Cryptographic Primitive'}
                        </td>
                        <td className="py-3.5 pr-3">
                          <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
                            <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-[180px]" title={item.location}>
                              {item.location || 'Endpoint / Session'}
                            </span>
                            {item.line_number && <span className="text-slate-500">:{item.line_number}</span>}
                          </div>
                        </td>
                        <td className="py-3.5 text-right">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                              (item.confidence || 'HIGH').toUpperCase() === 'HIGH'
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50'
                                : 'bg-amber-950/60 text-amber-300 border-amber-800/50'
                            }`}
                          >
                            {item.confidence || 'HIGH'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400 py-6 text-center">
                No items match the selected sub-category filter.
              </p>
            )}
          </div>

          {/* Detailed Findings & Standards Violations List */}
          {asset.risks && asset.risks.length > 0 && (
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                <Shield className="w-5 h-5 text-rose-400" />
                <h3 className="text-base font-bold text-white">Findings, Risk Assessments &amp; Standards</h3>
              </div>

              <div className="space-y-4">
                {asset.risks.map((risk, index) => (
                  <div key={index} className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={risk.severity} />
                        <span className="text-xs font-semibold text-slate-300">{risk.classical_risk}</span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{risk.explanation}</p>

                    <div className="space-y-2 pt-2 border-t border-slate-900">
                      <div className="flex items-start gap-2 text-xs">
                        <span className="text-slate-500 font-mono shrink-0">Quantum Relevance:</span>
                        <span className="text-amber-300 font-sans">{risk.quantum_relevance}</span>
                      </div>

                      {risk.applied_rules && risk.applied_rules.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-xs text-slate-500 mr-1 font-mono">Standards:</span>
                          {risk.applied_rules.map((rule, rIdx) => (
                            <span
                              key={rIdx}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800"
                            >
                              {rule}
                            </span>
                          ))}
                        </div>
                      )}

                      {risk.policy_violations && risk.policy_violations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-xs text-rose-400 mr-1 font-mono">Violations:</span>
                          {risk.policy_violations.map((violation, vIdx) => (
                            <span
                              key={vIdx}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-900/60"
                            >
                              {violation}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Migration Roadmap & PQC Targets (5 cols) */}
        <div className="lg:col-span-5 space-y-8">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5 sticky top-24">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Cpu className="w-5 h-5 text-purple-400" />
              <h3 className="text-base font-bold text-white">PQC Remediation Roadmap</h3>
            </div>

            {asset.recommendations && asset.recommendations.length > 0 ? (
              <div className="space-y-6">
                {asset.recommendations.map((rec, idx) => (
                  <div key={idx} className="space-y-4">
                    {/* Target recommendation highlight */}
                    <div className="p-4 rounded-xl bg-purple-950/30 border border-purple-900/50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-purple-300 uppercase tracking-wider font-semibold">
                          Target Architecture
                        </span>
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded ${
                            rec.priority === 'critical'
                              ? 'bg-rose-900/80 text-rose-200'
                              : 'bg-purple-900/60 text-purple-200'
                          }`}
                        >
                          {rec.priority} priority
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-white">{rec.recommended_target}</div>
                    </div>

                    {/* Classical vs PQC dual tracks */}
                    <div className="space-y-3">
                      {rec.classical_remediation && (
                        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                            Phase 1: Classical Hardening
                          </p>
                          <p className="text-xs text-slate-200">{rec.classical_remediation}</p>
                        </div>
                      )}

                      {rec.pqc_migration && (
                        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                          <p className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
                            Phase 2: Post-Quantum Migration
                          </p>
                          <p className="text-xs text-slate-200">{rec.pqc_migration}</p>
                        </div>
                      )}
                    </div>

                    {/* Migration Characteristics Matrix */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                        <span className="text-slate-500 block text-[11px]">Complexity:</span>
                        <span className="font-semibold text-slate-300 capitalize">
                          {rec.migration_complexity || 'Medium'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                        <span className="text-slate-500 block text-[11px]">Latency Impact:</span>
                        <span className="font-semibold text-slate-300 capitalize">{rec.latency_impact || 'Low'}</span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                        <span className="text-slate-500 block text-[11px]">Bandwidth Impact:</span>
                        <span className="font-semibold text-slate-300 capitalize">
                          {rec.bandwidth_impact || 'Medium'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80">
                        <span className="text-slate-500 block text-[11px]">Cost Category:</span>
                        <span className="font-semibold text-slate-300 capitalize">
                          {rec.cost_category || 'Operational'}
                        </span>
                      </div>
                    </div>

                    {rec.rationale && (
                      <div className="text-xs text-slate-400 leading-relaxed">
                        <span className="font-semibold text-slate-300 block mb-1">Architectural Rationale:</span>
                        {rec.rationale}
                      </div>
                    )}

                    {rec.references && rec.references.length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
                          Compliance Standards &amp; RFCs:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {rec.references.map((refStr, rIdx) => (
                            <span
                              key={rIdx}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700"
                            >
                              {refStr}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-slate-950/40 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <p className="text-sm font-medium text-white">No Immediate Remediation Required</p>
                <p className="text-xs text-slate-400">
                  This asset conforms to current quantum-safe standards and classical cipher lifetime requirements.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
