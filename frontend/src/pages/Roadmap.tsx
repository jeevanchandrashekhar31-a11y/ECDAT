import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Milestone,
  Shield,
  AlertTriangle,
  Clock,
  ArrowRight,
  ExternalLink,
  Download,
  Printer,
  FileText,
  Filter,
  CheckCircle2,
  RefreshCw,
  Cpu,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardSummary, TopRiskyAsset } from '../types';
import { pdf } from '@react-pdf/renderer';
import { RoadmapPDFDocument } from '../components/RoadmapPDFDocument';

// Suggested 5-step sequence definition adhering to specification
interface SequenceStep {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  focusAlgorithms: string[];
  recommendedPhase: string;
  icon: typeof AlertTriangle;
  accentColor: string;
}

const SEQUENCE_STEPS: SequenceStep[] = [
  {
    id: 1,
    title: '1. Remove Classically Broken Crypto',
    subtitle: 'Immediate Zero-Tolerance Classical Hardening',
    description:
      'Eradicate deprecated ciphers, weak hashing, sub-2048-bit RSA keys, and hardcoded secrets from codebase and configuration vaults.',
    focusAlgorithms: ['MD5', 'SHA-1', 'DES', '3DES', 'RC4', 'RSA-1024', 'Hardcoded Keys'],
    recommendedPhase: 'Immediate (0 - 6 months)',
    icon: AlertTriangle,
    accentColor: 'rose',
  },
  {
    id: 2,
    title: '2. Upgrade Legacy Transport',
    subtitle: 'Perimeter & In-Transit Cryptographic Hygiene',
    description:
      'Deprecate TLS 1.0 and 1.1 across all endpoints; enforce TLS 1.2+ / TLS 1.3 with AEAD cipher suites (AES-256-GCM / ChaCha20-Poly1305) and modern SSH key exchange.',
    focusAlgorithms: ['TLS 1.0', 'TLS 1.1', 'CBC Mode', 'Diffie-Hellman Group 1'],
    recommendedPhase: 'Short-term (3 - 12 months)',
    icon: Shield,
    accentColor: 'amber',
  },
  {
    id: 3,
    title: '3. Identify Long-Lived Confidentiality Assets',
    subtitle: 'Mitigate Store-Now-Decrypt-Later (SNDL) Exposure',
    description:
      'Identify database ciphertext, archives, PII, and financial records with confidentiality shelf-life X >= 7 years where adversaries could harvest traffic today.',
    focusAlgorithms: ['AES-128', 'RSA-2048 Data Encryption', 'Encrypted Backups'],
    recommendedPhase: 'Medium-term (6 - 18 months)',
    icon: Clock,
    accentColor: 'cyan',
  },
  {
    id: 4,
    title: '4. Pilot Hybrid PQC',
    subtitle: 'Composite Transition without Operational Disruption',
    description:
      'Deploy dual/composite key exchange (e.g., X25519MLKEM768) on edge reverse proxies and pilot ML-KEM envelope encryption for database column encryption keys.',
    focusAlgorithms: ['X25519MLKEM768', 'SecP256r1MLKEM768', 'Hybrid KEX'],
    recommendedPhase: 'Piloting (12 - 24 months)',
    icon: Cpu,
    accentColor: 'purple',
  },
  {
    id: 5,
    title: '5. Measure and Deploy',
    subtitle: 'Telemetry-Validated Production Cutover',
    description:
      'Profile real-world latency, packet MTU fragmentation, and bandwidth overhead. Validate client ecosystem compatibility, and finalize FIPS 203/204 standard deployment.',
    focusAlgorithms: ['NIST FIPS 203 (ML-KEM)', 'NIST FIPS 204 (ML-DSA)', 'FIPS 205 (SLH-DSA)'],
    recommendedPhase: 'Production Readiness (2026 - 2030)',
    icon: CheckCircle2,
    accentColor: 'emerald',
  },
];

export const Roadmap: React.FC = () => {
  const [searchParams] = useSearchParams();
  const scanId = searchParams.get('scanId') || undefined;

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeStepFilter, setActiveStepFilter] = useState<number | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [downloadingJson, setDownloadingJson] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState<Record<number, boolean>>({});

  const toggleTechnicalDetails = (id: number) => {
    setShowTechnicalDetails((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    let mounted = true;
    const fetchSummary = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getDashboardSummary(scanId);
        if (mounted) {
          setSummary(data);
        }
      } catch (err: unknown) {
        if (mounted) {
          const message = err instanceof Error ? err.message : 'Failed to retrieve roadmap telemetry.';
          setError(message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchSummary();
    return () => {
      mounted = false;
    };
  }, [scanId]);

  // Enrich recommendations with sequence step mapping
  const enrichedRecommendations = useMemo(() => {
    if (!summary?.recommendations) return [];
    return summary.recommendations.map((rec, index) => {
      const target = (rec.recommended_target || '').toLowerCase();
      const current = (rec.current_state || '').toLowerCase();
      const classical = (rec.classical_remediation || '').toLowerCase();

      let stepId = 1;
      if (
        /\b(md5|sha-?1|des|rc4|hardcoded)\b/i.test(current) ||
        current.includes('1024') ||
        classical.includes('immediately') ||
        classical.includes('revoke')
      ) {
        stepId = 1;
      } else if (
        current.includes('tls 1.0') ||
        current.includes('tls 1.1') ||
        /\b(ssh|transport)\b/i.test(current)
      ) {
        stepId = 2;
      } else if (
        /\b(stored|data|aes-128|shelf)\b/i.test(current)
      ) {
        stepId = 3;
      } else if (target.includes('hybrid') || target.includes('ml-kem') || rec.hybrid_transition_recommended) {
        stepId = 4;
      } else {
        stepId = 5;
      }

      return {
        ...rec,
        id: index + 1,
        sequenceStep: stepId,
      };
    });
  }, [summary]);

  // Filter recommendations based on active step and priority
  const filteredRecommendations = useMemo(() => {
    return enrichedRecommendations.filter((rec) => {
      if (activeStepFilter !== null && rec.sequenceStep !== activeStepFilter) {
        return false;
      }
      if (priorityFilter !== 'all' && rec.priority !== priorityFilter) {
        return false;
      }
      return true;
    });
  }, [enrichedRecommendations, activeStepFilter, priorityFilter]);

  // Export JSON handler
  const handleExportJson = () => {
    setDownloadingJson(true);
    try {
      const payload = {
        scan_id: summary?.scan_id || scanId || 'active_scan',
        policy_profile: summary?.policy_profile || 'standard',
        scenario: summary?.scenario || 'baseline',
        suggested_sequence: SEQUENCE_STEPS.map((s) => ({
          step: s.id,
          title: s.title,
          phase: s.recommendedPhase,
          focus_algorithms: s.focusAlgorithms,
        })),
        recommendations: enrichedRecommendations,
        top_risky_assets: summary?.top_risky_assets || [],
        dependencies_and_assumptions: summary?.assumptions || [
          'Consensus timeline estimates CRQC emergence ~2035 (Baseline Scenario).',
          'NIST PQC standards FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) finalized August 2024.',
          'Hybrid key encapsulation ensures dual-protection without violating FIPS 140-3 boundary compliance.',
        ],
        exported_at: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ecdat_pqc_migration_roadmap_${summary?.scan_id || 'active'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export roadmap JSON.');
    } finally {
      setDownloadingJson(false);
    }
  };

  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const doc = <RoadmapPDFDocument summary={summary} sequenceSteps={SEQUENCE_STEPS} enrichedRecommendations={enrichedRecommendations} />;
      const asPdf = pdf(doc);
      const blob = await asPdf.toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ECDAT_Roadmap_${summary?.scan_id || 'Active'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate PDF:', err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-800 animate-pulse rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-40 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
          ))}
        </div>
        <div className="h-96 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="p-8 rounded-xl bg-red-950/20 border border-red-900/40 text-center space-y-4">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
        <h2 className="text-xl font-semibold text-white">Roadmap Telemetry Unavailable</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto">{error || 'Please ensure CBOM data is ingested.'}</p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  const defaultAssumptions = summary.assumptions || [
    'Baseline quantum timeline assumes Cryptanalytically Relevant Quantum Computer (CRQC) emergence around 2035.',
    'NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) standards finalized August 2024; client library and HSM firmware ecosystems are in active rollout.',
    'Hybrid key establishment (combining classical X25519/ECDH with ML-KEM) is mandated during transition to ensure non-regression if novel quantum cryptanalysis weaknesses emerge.',
    'Zero secret literal policy: private keys must remain inside HSM or KMS envelopes and never appear in source code or telemetry.',
  ];

  return (
    <div className="space-y-8 animate-fade-in print:text-slate-900 print:bg-white print:p-0">
      {/* 1. Header & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5 print:border-b-2 print:border-slate-800 print:pb-6 print:mb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-950/60 border border-purple-800/50 text-purple-400 print:hidden">
              <Milestone className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white font-mono tracking-tight print:text-slate-900">
                PQC Migration Roadmap &amp; Execution View
              </h1>
              <p className="text-xs md:text-sm text-slate-400 print:text-slate-600">
                Actionable, prioritized post-quantum transition plan rooted in cryptographic discovery and Mosca Theorem
                risk calculus.
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons (Export JSON, Print, View Report) */}
        <div className="flex items-center gap-2.5 print:hidden">
          <button
            onClick={handleExportJson}
            disabled={downloadingJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all shadow-sm disabled:opacity-50"
            title="Download complete migration roadmap JSON payload"
          >
            {downloadingJson ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Export JSON</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all shadow-sm disabled:opacity-50"
            title="Download formal PDF Roadmap"
          >
            {downloadingPdf ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Printer className="w-3.5 h-3.5" />
            )}
            <span>{downloadingPdf ? 'Generating PDF...' : 'Download Formal PDF'}</span>
          </button>

          <Link
            to={`/reports${scanId ? `?scanId=${scanId}` : ''}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-all shadow-md"
            title="View complete standalone compliance reports and CBOM exports"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Compliance Reports</span>
          </Link>
        </div>
      </div>

      {/* 2. Pragmatic Engineering Notice (No Overpromising) */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-amber-900/40 relative overflow-hidden print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
        <div className="flex items-start gap-3">
          <div className="p-1.5 rounded-lg bg-amber-950/60 border border-amber-800/50 text-amber-400 shrink-0 mt-0.5 print:text-amber-700">
            <Info className="w-4 h-4" />
          </div>
          <div className="space-y-1 text-xs">
            <div className="font-bold text-amber-300 uppercase tracking-wider print:text-amber-800">
              Pragmatic Engineering Notice — Standards-Aligned Hybrid Transition
            </div>
            <p className="text-slate-300 leading-relaxed print:text-slate-700">
              This roadmap enforces a dual-track transition strategy designed specifically to{' '}
              <strong className="text-white print:text-black font-semibold">
                avoid overpromising unsupported standalone PQC deployment
              </strong>
              . Phase 1 prioritizes mandatory classical cryptographic hygiene (e.g. eradicating MD5, DES, and hardcoded
              private keys). Phase 2 deploys standards-compliant{' '}
              <strong>hybrid key exchange (e.g. X25519MLKEM768)</strong> where classical and post-quantum mechanisms
              operate in tandem. Direct standalone PQC cutover is deferred until ecosystem trust chains, client
              operating systems, and HSM firmware reach verified commercial maturity.
            </p>
          </div>
        </div>
      </div>

      {/* 3. Suggested Sequence 5-Phase Interactive Visual Stepper */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Suggested Execution Sequence (5 Strategic Phases)</span>
          </div>
          {activeStepFilter !== null && (
            <button
              onClick={() => setActiveStepFilter(null)}
              className="text-xs text-cyan-400 hover:underline font-medium"
            >
              Clear Phase Filter (Show All)
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 print:grid-cols-2 gap-4 print:gap-6">
          {SEQUENCE_STEPS.map((step) => {
            const isSelected = activeStepFilter === step.id;
            const StepIcon = step.icon;

            return (
              <div
                key={step.id}
                onClick={() => setActiveStepFilter(isSelected ? null : step.id)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 relative group ${
                  isSelected
                    ? 'bg-cyan-950/40 border-cyan-500 ring-1 ring-cyan-500/50 shadow-lg'
                    : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:bg-slate-850'
                } print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-md print:rounded-xl print:p-8 print:shadow-md print:rounded-xl print:p-8`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      Step {step.id}
                    </span>
                    <StepIcon
                      className={`w-4 h-4 ${
                        step.id === 1
                          ? 'text-rose-400'
                          : step.id === 2
                            ? 'text-amber-400'
                            : step.id === 3
                              ? 'text-cyan-400'
                              : step.id === 4
                                ? 'text-purple-400'
                                : 'text-emerald-400'
                      }`}
                    />
                  </div>

                  <h3 className="text-xs font-bold text-white group-hover:text-cyan-300 transition-colors line-clamp-2 print:text-slate-900">
                    {step.title.replace(/^\d+\.\s*/, '')}
                  </h3>

                  <p className="text-[11px] text-slate-400 leading-snug line-clamp-3 print:text-slate-600">
                    {step.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800/60 text-[10px] font-mono text-slate-500 flex items-center justify-between">
                  <span>{step.recommendedPhase.split(' ')[0]}</span>
                  <span className="text-cyan-400 font-semibold group-hover:underline">
                    {isSelected ? 'Selected' : 'Filter Step'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Filter Controls for Recommendations */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 print:hidden">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-slate-300">Filter Recommendations:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {(['all', 'critical', 'high', 'medium', 'low'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`px-3 py-1 rounded-lg capitalize font-medium transition-all ${
                priorityFilter === p
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {p} Priority
            </button>
          ))}
        </div>
      </div>

      {/* 5. Detailed Actionable Recommendations Queue */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <h2 className="text-base font-bold text-white tracking-wide print:text-slate-900">
              Prioritized Action Queue ({filteredRecommendations.length} Recommendations)
            </h2>
          </div>
          {activeStepFilter && (
            <span className="text-xs text-cyan-400 font-mono">Showing Step {activeStepFilter} Actions</span>
          )}
        </div>

        {filteredRecommendations.length > 0 ? (
          <div className="grid grid-cols-1 gap-5">
            {filteredRecommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-xl space-y-5 hover:border-slate-700 transition-colors print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-md print:rounded-xl print:p-8"
              >
                {/* Header: Priority & Target */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`text-[10px] font-mono uppercase px-2.5 py-0.5 rounded font-bold ${
                          rec.priority === 'critical'
                            ? 'bg-rose-950/70 text-rose-300 border border-rose-800/60 print:bg-rose-100 print:text-rose-800 print:border-rose-300'
                            : rec.priority === 'high'
                              ? 'bg-amber-950/70 text-amber-300 border border-amber-800/60 print:bg-amber-100 print:text-amber-800 print:border-amber-300'
                              : 'bg-purple-950/70 text-purple-300 border border-purple-800/60 print:bg-purple-100 print:text-purple-800 print:border-purple-300'
                        }`}
                      >
                        {rec.priority} Priority
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                        Sequence Step {rec.sequenceStep}
                      </span>
                      {rec.hybrid_transition_recommended && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/50">
                          Hybrid Transition Recommended
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white font-mono mt-1 print:text-slate-900">
                      {rec.recommended_target}
                    </h3>
                  </div>

                  <div className="text-right text-xs text-slate-400 font-mono">
                    Complexity:{' '}
                    <strong className="text-slate-200 capitalize print:text-slate-800">
                      {rec.migration_complexity || 'Medium'}
                    </strong>
                  </div>
                </div>

                {/* Current State vs Dual-Track Remediation */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Current State */}
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Current Cryptographic State
                    </p>
                    <p className="text-xs font-mono text-slate-200 print:text-slate-800">{rec.current_state}</p>
                  </div>

                  {/* Phase 1: Classical Remediation */}
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                    <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider print:text-amber-800">
                      Phase 1: Classical Remediation
                    </p>
                    <p className="text-xs text-slate-200 leading-relaxed print:text-slate-700">
                      {rec.classical_remediation || 'Maintain standard classical cryptographic baseline requirements.'}
                    </p>
                  </div>

                  {/* Phase 2: PQC / Hybrid Path */}
                  <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                    <p className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider print:text-cyan-800">
                      Phase 2: Post-Quantum Migration
                    </p>
                    <p className="text-xs text-slate-200 leading-relaxed print:text-slate-700">
                      {rec.pqc_migration || 'Evaluate NIST FIPS 203 (ML-KEM) standard migration path.'}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-2 border-t border-slate-800/60 print:hidden">
                  <button
                    onClick={() => toggleTechnicalDetails(rec.id)}
                    className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    {showTechnicalDetails[rec.id] ? 'Hide Technical Details' : 'Show Technical Details'}
                  </button>
                </div>

                {showTechnicalDetails[rec.id] && (
                  <div className="space-y-4 pt-4 border-t border-slate-800/60 mt-4">
                    {/* Engineering Impact Matrix */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                        <span className="text-slate-500 block text-[10px] uppercase font-mono">Complexity</span>
                        <span className="font-semibold text-slate-200 capitalize print:text-slate-900">
                          {rec.migration_complexity || 'Medium'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                        <span className="text-slate-500 block text-[10px] uppercase font-mono">Latency Impact</span>
                        <span className="font-semibold text-slate-200 capitalize print:text-slate-900">
                          {rec.latency_impact || 'Low (<5ms)'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                        <span className="text-slate-500 block text-[10px] uppercase font-mono">Bandwidth Overhead</span>
                        <span className="font-semibold text-slate-200 capitalize print:text-slate-900">
                          {rec.bandwidth_impact || 'Moderate (+1-2KB)'}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800/80 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm">
                        <span className="text-slate-500 block text-[10px] uppercase font-mono">Cost Category</span>
                        <span className="font-semibold text-slate-200 capitalize print:text-slate-900">
                          {rec.cost_category || 'Operational'}
                        </span>
                      </div>
                    </div>

                    {/* Architectural Rationale & Standards References */}
                    <div className="space-y-3">
                      {rec.rationale && (
                        <div className="text-xs text-slate-300 leading-relaxed font-sans print:text-slate-700">
                          <strong className="text-white block mb-1 print:text-slate-900 font-mono">
                            Architectural Rationale:
                          </strong>
                          {rec.rationale}
                        </div>
                      )}

                      {rec.references && rec.references.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-slate-400 font-mono mr-1">Standards References:</span>
                          {rec.references.map((refStr, rIdx) => (
                            <span
                              key={rIdx}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 print:border-slate-300 print:text-slate-800 print:bg-slate-100"
                            >
                              {refStr}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm font-semibold text-white">No actions match the active phase and priority filter.</p>
            <p className="text-xs text-slate-400">
              Try resetting filters to inspect the complete organizational migration backlog.
            </p>
            <button
              onClick={() => {
                setActiveStepFilter(null);
                setPriorityFilter('all');
              }}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* 6. Highest Priority Assets Table */}
      {summary.top_risky_assets && summary.top_risky_assets.length > 0 && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-md print:rounded-xl print:p-8">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-rose-400" />
              <h2 className="text-base font-bold text-white tracking-wide print:text-slate-900">
                Highest Priority Assets Requiring Remediation
              </h2>
            </div>
            <Link
              to="/assets"
              className="text-xs text-cyan-400 hover:underline inline-flex items-center gap-1 print:hidden"
            >
              <span>View Full Inventory</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[11px] print:border-slate-300 print:text-slate-700">
                <tr>
                  <th className="pb-3 pr-3">Logical Asset</th>
                  <th className="pb-3 pr-3">Risk & Exposure</th>
                  <th className="pb-3 pr-3">Occurrences</th>
                  <th className="pb-3 pr-3">Usage Types</th>
                  <th className="pb-3 pr-3">Mosca Status</th>
                  <th className="pb-3 pr-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans print:divide-slate-300">
                {summary.top_risky_assets.map((asset: TopRiskyAsset) => (
                  <tr
                    key={asset.asset_id}
                    className="hover:bg-slate-800/30 transition-colors print:hover:bg-transparent"
                  >
                    <td className="py-3.5 pr-3 font-mono font-bold text-white print:text-slate-900">
                      <div className="text-sm truncate max-w-[220px]" title={asset.primary_identifier || asset.algorithm}>
                        {asset.primary_identifier || asset.algorithm}
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans mt-0.5">{asset.asset_type.replace(/_/g, ' ')}</div>
                    </td>
                    <td className="py-3.5 pr-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${
                            asset.severity === 'Critical' || asset.severity === 'CRITICAL'
                              ? 'bg-rose-950/70 text-rose-300 border border-rose-800/60'
                              : asset.severity === 'High' || asset.severity === 'HIGH'
                              ? 'bg-amber-950/70 text-amber-300 border border-amber-800/60'
                              : 'bg-slate-800 text-slate-300 border border-slate-700'
                          }`}
                        >
                          {asset.severity}
                        </span>
                        <span className="text-[10px] text-slate-400 capitalize">
                          {(asset.exposures || []).join(', ')}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 pr-3 text-slate-300">
                      {asset.occurrences || 1}
                    </td>
                    <td className="py-3.5 pr-3 text-slate-300 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {(asset.usage_types || []).map((u: string) => (
                          <span key={u} className="text-[9px] uppercase px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700">{u.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 pr-3">
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                        {asset.mosca_status}
                      </span>
                    </td>
                    <td className="py-3.5 text-left print:hidden">
                      <Link
                        to={`/assets/${encodeURIComponent(asset.asset_id)}${scanId ? `?scanId=${scanId}` : ''}`}
                        className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline text-xs bg-slate-950/50 px-2 py-1 rounded border border-cyan-900/50"
                      >
                        <span>Inspect</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. Dependencies & Assumptions Section */}
      <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4 print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm print:break-inside-avoid">
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
          <Info className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider print:text-slate-900">
            Roadmap Dependencies &amp; Architectural Assumptions
          </h2>
        </div>

        <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc list-inside font-sans print:text-slate-700">
          {defaultAssumptions.map((assumption, idx) => (
            <li key={idx} className="pl-1">
              {assumption}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
