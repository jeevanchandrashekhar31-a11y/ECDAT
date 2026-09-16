import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import {
  Shield,
  Layers,
  AppWindow,
  Flame,
  Atom,
  FileCheck2,
  Binary,
  Globe,
  Activity,
  FileWarning,
  Wrench,
  Users,
  History,
  Sliders,
  RefreshCw,
  Play,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { api } from '../api/client';
import { DashboardViewsResponse } from '../types';
import { EvidenceDrawer } from '../components/EvidenceDrawer';

// 13 Specialized Dashboard Views
import { ExecutiveOverviewView } from '../components/dashboard/ExecutiveOverviewView';
import { CryptoInventoryView } from '../components/dashboard/CryptoInventoryView';
import { ApplicationInventoryView } from '../components/dashboard/ApplicationInventoryView';
import { RiskHeatmapView } from '../components/dashboard/RiskHeatmapView';
import { PqcReadinessView } from '../components/dashboard/PqcReadinessView';
import { CertificatesView } from '../components/dashboard/CertificatesView';
import { AlgorithmsView } from '../components/dashboard/AlgorithmsView';
import { NetworkEndpointsView } from '../components/dashboard/NetworkEndpointsView';
import { RuntimeObservationsView } from '../components/dashboard/RuntimeObservationsView';
import { PolicyViolationsView } from '../components/dashboard/PolicyViolationsView';
import { RemediationView } from '../components/dashboard/RemediationView';
import { OwnershipView } from '../components/dashboard/OwnershipView';
import { AuditTrailView } from '../components/dashboard/AuditTrailView';

export type DashboardTab =
  | 'executive_overview'
  | 'crypto_inventory'
  | 'application_inventory'
  | 'risk_heatmap'
  | 'pqc_readiness'
  | 'certificates'
  | 'algorithms'
  | 'network_endpoints'
  | 'runtime_observations'
  | 'policy_violations'
  | 'remediation'
  | 'ownership'
  | 'audit_trail';

interface TabConfig {
  id: DashboardTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
}

export const Dashboard: React.FC = () => {
  const outlet = useOutletContext<{ selectedScanId?: string; onUploadSuccess?: (id: string) => void }>() || {};
  const selectedScanId = outlet.selectedScanId;

  // Active view tab state
  const [activeTab, setActiveTab] = useState<DashboardTab>('executive_overview');

  // Governance settings
  const [selectedPolicy, setSelectedPolicy] = useState<string>('regulated_bfsi');
  const [selectedScenario, setSelectedScenario] = useState<string>('baseline');

  // Dashboard dataset states
  const [viewsData, setViewsData] = useState<DashboardViewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Evidence Drawer State (Crucial: Every number links to evidence)
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

  // Collapsible Quick Scan Operations drawer
  const [showScanDrawer, setShowScanDrawer] = useState(false);
  const [networkTarget, setNetworkTarget] = useState<string>('');
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchDashboardData = useCallback(async (overrideScanId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const activeId = overrideScanId !== undefined ? overrideScanId : selectedScanId;
      const res = await api.getDashboardViews(
        activeId && activeId !== 'all' ? activeId : undefined,
        selectedPolicy || undefined,
        selectedScenario || undefined
      );
      setViewsData(res);
      if (res.policy_profile && !selectedPolicy) {
        setSelectedPolicy(res.policy_profile);
      }
      if (res.scenario && !selectedScenario) {
        setSelectedScenario(res.scenario);
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to fetch enterprise dashboard views.');
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedPolicy, selectedScenario]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleOpenEvidence = (title: string, subtitle: string, evidenceIds: string[]) => {
    setEvidenceDrawer({
      isOpen: true,
      title,
      subtitle,
      evidenceIds: evidenceIds.length > 0 ? evidenceIds : Object.keys(viewsData?.evidence_lookup || {}).slice(0, 3),
    });
  };

  const handleCloseEvidence = () => {
    setEvidenceDrawer((prev) => ({ ...prev, isOpen: false }));
  };

  // Quick Network Discovery Trigger
  const handleQuickNetworkScan = async () => {
    if (!networkTarget) return;
    setRunningAction('network');
    setActionFeedback(null);
    try {
      const res = await api.triggerNetworkScan(networkTarget, 443, {
        policy_profile: selectedPolicy,
        scenario: selectedScenario,
      });
      setActionFeedback({
        message: `Network scan completed successfully! Ingested scan ID ${res.scan_id}`,
        type: 'success',
      });
      if (outlet.onUploadSuccess) {
        outlet.onUploadSuccess(res.scan_id);
      }
      fetchDashboardData(res.scan_id);
    } catch (err: unknown) {
      setActionFeedback({
        message: (err as Error).message || 'Network discovery failed.',
        type: 'error',
      });
    } finally {
      setRunningAction(null);
    }
  };

  // Tabs configuration (All 13 views)
  const tabs: TabConfig[] = [
    {
      id: 'executive_overview',
      label: 'Executive Overview',
      icon: Shield,
      badge: viewsData?.views.executive_overview.posture_score,
    },
    {
      id: 'crypto_inventory',
      label: 'Crypto Inventory',
      icon: Layers,
      badge: viewsData?.views.crypto_inventory.total_components,
    },
    {
      id: 'application_inventory',
      label: 'Application Inventory',
      icon: AppWindow,
      badge: viewsData?.views.application_inventory.total_applications,
    },
    {
      id: 'risk_heatmap',
      label: 'Risk Heatmap',
      icon: Flame,
      badge: viewsData?.views.risk_heatmap.active_hotspots_count,
    },
    {
      id: 'pqc_readiness',
      label: 'PQC Readiness',
      icon: Atom,
      badge: `${viewsData?.views.pqc_readiness.overall_readiness_score || 0}%`,
    },
    {
      id: 'certificates',
      label: 'Certificates',
      icon: FileCheck2,
      badge: viewsData?.views.certificates.total_certificates,
    },
    {
      id: 'algorithms',
      label: 'Algorithms',
      icon: Binary,
      badge: viewsData?.views.algorithms.total_distinct_algorithms,
    },
    {
      id: 'network_endpoints',
      label: 'Network Endpoints',
      icon: Globe,
      badge: viewsData?.views.network_endpoints.total_endpoints,
    },
    {
      id: 'runtime_observations',
      label: 'Runtime Observations',
      icon: Activity,
      badge: viewsData?.views.runtime_observations.total_observations,
    },
    {
      id: 'policy_violations',
      label: 'Policy Violations',
      icon: FileWarning,
      badge: viewsData?.views.policy_violations.total_violations,
    },
    {
      id: 'remediation',
      label: 'Remediation',
      icon: Wrench,
      badge: viewsData?.views.remediation.quick_wins_count,
    },
    {
      id: 'ownership',
      label: 'Ownership',
      icon: Users,
      badge: viewsData?.views.ownership.total_teams,
    },
    {
      id: 'audit_trail',
      label: 'Audit Trail',
      icon: History,
      badge: viewsData?.views.audit_trail.total_events,
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Top Header & Governance Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 glass-card p-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="text-[11px] font-mono uppercase tracking-widest text-cyan-400 font-semibold">
              Enterprise Dashboard • Phase 17.1
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 tracking-tight">
            Cryptographic Security & PQC Executive Center
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Continuous CBOM discovery, Mosca quantum deficit horizons, and cryptographic compliance with zero unevidenced metrics.
          </p>
        </div>

        {/* Global Governance Filters & Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Policy Profile Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-slate-400 hidden sm:inline">Profile:</span>
            <select
              value={selectedPolicy}
              onChange={(e) => setSelectedPolicy(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium"
            >
              <option value="regulated_bfsi" className="bg-slate-900 text-slate-200">
                Regulated BFSI (Strict)
              </option>
              <option value="pci_dss_v4" className="bg-slate-900 text-slate-200">
                PCI-DSS v4.0
              </option>
              <option value="nist_sp_800_56c" className="bg-slate-900 text-slate-200">
                NIST SP 800-56C
              </option>
              <option value="general_saas" className="bg-slate-900 text-slate-200">
                General SaaS Baseline
              </option>
            </select>
          </div>

          {/* Scenario Selector */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-3 py-1.5 rounded-lg border border-slate-800 text-xs">
            <Atom className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-slate-400 hidden sm:inline">CRQC:</span>
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer font-medium"
            >
              <option value="conservative" className="bg-slate-900 text-slate-200">
                Conservative (2030)
              </option>
              <option value="baseline" className="bg-slate-900 text-slate-200">
                Baseline (2033)
              </option>
              <option value="aggressive" className="bg-slate-900 text-slate-200">
                Aggressive (2036)
              </option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => fetchDashboardData()}
            disabled={loading}
            className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-slate-700 transition-colors"
            title="Refresh dashboard views"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          {/* Trigger Scan Drawer Toggle */}
          <button
            onClick={() => setShowScanDrawer((prev) => !prev)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/60 inline-flex items-center gap-1.5 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Scan Operations</span>
            {showScanDrawer ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Collapsible Quick Scan Operations Drawer */}
      {showScanDrawer && (
        <div className="glass-card p-5 border-cyan-850 bg-slate-950/70 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Play className="w-4 h-4 text-cyan-400" />
              <span>Operational Scanners & CBOM Pipeline</span>
            </h4>
            <span className="text-xs text-slate-500">Run quick discovery on network endpoint or test targets</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[260px]">
              <input
                type="text"
                placeholder="Target endpoint (e.g. api.ecdat.io:443 or https://gateway.internal)"
                value={networkTarget}
                onChange={(e) => setNetworkTarget(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-slate-900 border border-slate-800 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>
            <button
              onClick={handleQuickNetworkScan}
              disabled={Boolean(runningAction) || !networkTarget}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold disabled:opacity-50 inline-flex items-center gap-1.5 transition-colors"
            >
              {runningAction === 'network' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Scanning...</span>
                </>
              ) : (
                <>
                  <Globe className="w-3.5 h-3.5" />
                  <span>Execute Discovery</span>
                </>
              )}
            </button>
            <Link
              to="/scans"
              className="px-3 py-2 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors inline-flex items-center gap-1"
            >
              <span>Full Pipeline Center</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          {actionFeedback && (
            <div
              className={`mt-3 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                actionFeedback.type === 'success'
                  ? 'bg-emerald-950/80 border border-emerald-700/60 text-emerald-300'
                  : 'bg-rose-950/80 border border-rose-700/60 text-rose-300'
              }`}
            >
              {actionFeedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{actionFeedback.message}</span>
            </div>
          )}
        </div>
      )}

      {/* 13 View Tabs Navigation Bar */}
      <div className="glass-card p-1.5 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-cyan-950 text-cyan-200 border border-cyan-700/70 shadow-md shadow-cyan-950/40'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                      isActive
                        ? 'bg-cyan-850 text-cyan-300 border border-cyan-700/60'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main View Area */}
      {loading && !viewsData ? (
        <div className="glass-card p-16 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-10 h-10 text-cyan-400 animate-spin mb-3" />
          <p className="text-sm font-semibold text-slate-200">
            Synthesizing Enterprise Cryptographic Evidence...
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            Evaluating AST call sites, CBOM components, and Mosca quantum threat horizons.
          </p>
        </div>
      ) : error ? (
        <div className="glass-card p-8 border-rose-800 bg-rose-950/20 text-center">
          <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-2" />
          <h3 className="text-base font-bold text-rose-200">Dashboard Loading Failure</h3>
          <p className="text-xs text-rose-300 mt-1">{error}</p>
          <button
            onClick={() => fetchDashboardData()}
            className="mt-4 px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-900 hover:bg-rose-800 text-white transition-colors"
          >
            Retry Connection
          </button>
        </div>
      ) : viewsData ? (
        <div>
          {/* Active View Dispatcher */}
          {activeTab === 'executive_overview' && (
            <ExecutiveOverviewView
              data={viewsData.views.executive_overview}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'crypto_inventory' && (
            <CryptoInventoryView
              data={viewsData.views.crypto_inventory}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'application_inventory' && (
            <ApplicationInventoryView
              data={viewsData.views.application_inventory}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'risk_heatmap' && (
            <RiskHeatmapView
              data={viewsData.views.risk_heatmap}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'pqc_readiness' && (
            <PqcReadinessView
              data={viewsData.views.pqc_readiness}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'certificates' && (
            <CertificatesView
              data={viewsData.views.certificates}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'algorithms' && (
            <AlgorithmsView
              data={viewsData.views.algorithms}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'network_endpoints' && (
            <NetworkEndpointsView
              data={viewsData.views.network_endpoints}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'runtime_observations' && (
            <RuntimeObservationsView
              data={viewsData.views.runtime_observations}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'policy_violations' && (
            <PolicyViolationsView
              data={viewsData.views.policy_violations}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'remediation' && (
            <RemediationView
              data={viewsData.views.remediation}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'ownership' && (
            <OwnershipView
              data={viewsData.views.ownership}
              evidenceLookup={viewsData.evidence_lookup}
              onOpenEvidence={handleOpenEvidence}
            />
          )}

          {activeTab === 'audit_trail' && (
            <AuditTrailView
              data={viewsData.views.audit_trail}
            />
          )}
        </div>
      ) : null}

      {/* Slide-over Evidence Drawer: Every number links to evidence */}
      <EvidenceDrawer
        isOpen={evidenceDrawer.isOpen}
        title={evidenceDrawer.title}
        subtitle={evidenceDrawer.subtitle}
        evidenceIds={evidenceDrawer.evidenceIds}
        evidenceLookup={viewsData?.evidence_lookup || {}}
        onClose={handleCloseEvidence}
      />
    </div>
  );
};
