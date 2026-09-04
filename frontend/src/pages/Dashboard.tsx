import React, { useState, useEffect, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import {
  ShieldAlert,
  Layers,
  FileCode2,
  Atom,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Cpu,
  RefreshCw,
  Clock,
  HelpCircle,
  TrendingUp,
  Server,
  Network,
  Eye,
  Sliders,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts';
import { api } from '../api/client';
import { DashboardSummary } from '../types';
import { MetricCard } from '../components/MetricCard';
import { SeverityBadge, MoscaStatusBadge } from '../components/SeverityBadge';
import { MoscaTable } from '../components/MoscaTable';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#f43f5e',
  high: '#f59e0b',
  medium: '#06b6d4',
  low: '#6366f1',
  informational: '#64748b',
};

const MOSCA_COLORS: Record<string, string> = {
  CRITICAL_URGENT: '#ef4444',
  AT_RISK: '#f59e0b',
  WATCH: '#0ea5e9',
  SAFE: '#10b981',
};

const SOURCE_COLORS: Record<string, string> = {
  network: '#06b6d4',
  static: '#a855f7',
  'binary-container': '#3b82f6',
};

export const Dashboard: React.FC = () => {
  const { selectedScanId } = useOutletContext<{ selectedScanId?: string }>();

  // Interactive controls state
  const [selectedPolicy, setSelectedPolicy] = useState<string>('');
  const [selectedScenario, setSelectedScenario] = useState<string>('baseline');

  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAccessibleTables, setShowAccessibleTables] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDashboardSummary(
        selectedScanId || undefined,
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
      setError((err as Error).message || 'Failed to connect to ECDAT backend.');
    } finally {
      setLoading(false);
    }
  }, [selectedScanId, selectedPolicy, selectedScenario]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-16 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-28 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-72 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
          <div className="h-72 bg-slate-900/60 border border-slate-800 rounded-xl animate-pulse"></div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-8 rounded-2xl bg-rose-950/20 border border-rose-900/40 text-center space-y-4">
        <AlertOctagon className="w-12 h-12 text-rose-400 mx-auto" />
        <h2 className="text-xl font-bold text-white">Dashboard Telemetry Unavailable</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto">{error}</p>
        <button
          onClick={fetchSummary}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-semibold transition-colors"
        >
          Retry Connection
        </button>
      </div>
    );
  }

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

  // Severity Donut Data
  const severityChartData = [
    { name: 'Critical', value: metrics.severity_counts.critical, color: SEVERITY_COLORS.critical },
    { name: 'High', value: metrics.severity_counts.high, color: SEVERITY_COLORS.high },
    { name: 'Medium', value: metrics.severity_counts.medium, color: SEVERITY_COLORS.medium },
    { name: 'Low', value: metrics.severity_counts.low, color: SEVERITY_COLORS.low },
    { name: 'Info', value: metrics.severity_counts.informational, color: SEVERITY_COLORS.informational },
  ].filter((d) => d.value > 0);

  // Mosca Bar Data
  const moscaChartData = [
    {
      name: 'CRITICAL URGENT',
      count: metrics.mosca_status_counts.CRITICAL_URGENT,
      color: MOSCA_COLORS.CRITICAL_URGENT,
    },
    { name: 'AT RISK', count: metrics.mosca_status_counts.AT_RISK, color: MOSCA_COLORS.AT_RISK },
    { name: 'WATCH', count: metrics.mosca_status_counts.WATCH, color: MOSCA_COLORS.WATCH },
    { name: 'SAFE', count: metrics.mosca_status_counts.SAFE, color: MOSCA_COLORS.SAFE },
  ];

  // Ingestion Source Data
  const findingsBySource = data?.findings_by_source || { network: 0, static: 0, 'binary-container': 0 };
  const sourceChartData = [
    { name: 'Network (TLS/SSH)', value: findingsBySource.network, color: SOURCE_COLORS.network },
    { name: 'Static Code (AST/Regex)', value: findingsBySource.static, color: SOURCE_COLORS.static },
    {
      name: 'Binary / Container',
      value: findingsBySource['binary-container'],
      color: SOURCE_COLORS['binary-container'],
    },
  ].filter((d) => d.value > 0);

  // Risk Trend Data (Historical Scans)
  const riskTrend =
    data?.risk_trend && data.risk_trend.length > 0
      ? data.risk_trend
      : [
          {
            date: 'Initial Scan',
            critical: metrics.severity_counts.critical,
            high: metrics.severity_counts.high,
            quantum_risk: metrics.assets_at_quantum_risk,
          },
        ];

  const totalAtRisk =
    (metrics.assets_at_risk ?? metrics.mosca_status_counts.AT_RISK) +
    (metrics.assets_critical_urgent ?? metrics.mosca_status_counts.CRITICAL_URGENT);

  const topAlgorithms = data?.most_common_risky_algorithms || [];
  const topServices = data?.top_affected_services || [];

  return (
    <div className="space-y-7 animate-fade-in">
      {/* 1. TOP BANNER & SCENARIO CONTROLS */}
      <div className="p-5 md:p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 shadow-xl relative overflow-hidden">
        <div
          className={`absolute top-0 left-0 bottom-0 w-2 ${totalAtRisk > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`}
        ></div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pl-2">
          {/* Headline Message */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/50 uppercase font-semibold">
                Executive Quantum Briefing
              </span>
              <span className="text-2xs font-mono text-slate-500">Rule Engine v{data?.rule_version || '2026.1'}</span>
            </div>

            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              Quantum readiness posture:{' '}
              <span
                className={
                  totalAtRisk > 0 ? 'text-amber-400 font-mono font-black' : 'text-emerald-400 font-mono font-black'
                }
              >
                {totalAtRisk} asset{totalAtRisk === 1 ? '' : 's'}
              </span>{' '}
              are at risk under the selected Mosca scenario.
            </h1>

            <p className="text-xs text-slate-400 max-w-3xl">
              Evaluated under Mosca’s Theorem ($X + Y &gt; Z$), measuring whether data confidentiality shelf-life ($X$)
              plus migration lead time ($Y$) outlives the cryptanalytically relevant quantum horizon ($Z$).
            </p>
          </div>

          {/* Interactive Policy & Scenario Selectors */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Scenario Selector */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="scenario-select"
                className="text-2xs font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1"
              >
                <Sliders className="w-3 h-3 text-cyan-400" />
                Mosca Scenario:
              </label>
              <select
                id="scenario-select"
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-400 font-mono"
              >
                <option value="optimistic">Optimistic (Z = 12 yrs)</option>
                <option value="baseline">Baseline (Z = 9 yrs)</option>
                <option value="conservative">Conservative (Z = 6 yrs)</option>
              </select>
            </div>

            {/* Policy Profile Selector */}
            <div className="flex flex-col gap-1">
              <label htmlFor="policy-select" className="text-2xs font-mono text-slate-400 uppercase tracking-wider">
                Policy Profile:
              </label>
              <select
                id="policy-select"
                value={selectedPolicy}
                onChange={(e) => setSelectedPolicy(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-400 font-mono"
              >
                <option value="regulated_bfsi">Regulated BFSI</option>
                <option value="internal_enterprise">Internal Enterprise</option>
                <option value="cnsa_2_0">CNSA 2.0 (High Security)</option>
                <option value="nist_pqc_2024">NIST PQC 2024</option>
                <option value="public_internet">Public Internet</option>
                <option value="iot_ot">IoT / Embedded OT</option>
              </select>
            </div>

            {/* Refresh Action */}
            <button
              onClick={fetchSummary}
              disabled={loading}
              title="Re-evaluate Telemetry"
              className="mt-4 p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors border border-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 2. EIGHT EXECUTIVE KPI CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Scanned Assets */}
        <MetricCard
          title="Total Scanned Assets"
          value={metrics.total_assets}
          subtitle="Unique hosts, repositories & images"
          icon={<Layers className="w-5 h-5 text-cyan-400" />}
          variant="cyan"
        />

        {/* Card 2: Total Crypto Findings */}
        <MetricCard
          title="Total Crypto Findings"
          value={metrics.total_findings}
          subtitle="Primitives, ciphers & protocols"
          icon={<FileCode2 className="w-5 h-5 text-violet-400" />}
          variant="violet"
        />

        {/* Card 3: Critical Findings */}
        <MetricCard
          title="Critical Findings"
          value={metrics.severity_counts.critical}
          subtitle="Immediate classical exploit risk"
          icon={<AlertOctagon className="w-5 h-5 text-rose-400" />}
          variant="rose"
        />

        {/* Card 4: Assets AT_RISK under Mosca */}
        <MetricCard
          title="Assets AT_RISK (Mosca)"
          value={metrics.assets_at_risk ?? metrics.mosca_status_counts.AT_RISK}
          subtitle="X + Y > Z (Deficit window active)"
          icon={<AlertTriangle className="w-5 h-5 text-amber-400" />}
          variant="amber"
        />

        {/* Card 5: Assets CRITICAL_URGENT */}
        <MetricCard
          title="Assets CRITICAL_URGENT"
          value={metrics.assets_critical_urgent ?? metrics.mosca_status_counts.CRITICAL_URGENT}
          subtitle="Immediate SNDL exposure danger"
          icon={<Atom className="w-5 h-5 text-rose-400" />}
          variant="rose"
        />

        {/* Card 6: Unknown / Unclassified Posture */}
        <MetricCard
          title="Unclassified Posture"
          value={`${metrics.unknown_posture_percentage ?? 0}%`}
          subtitle="Informational or unverified assets"
          icon={<HelpCircle className="w-5 h-5 text-slate-400" />}
          variant="slate"
        />

        {/* Card 7: Most Common Risky Algorithms */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Common Risky Algorithms
              </span>
              <Cpu className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {topAlgorithms.length > 0 ? (
                topAlgorithms.slice(0, 3).map((item) => (
                  <span
                    key={item.algorithm}
                    className="text-2xs font-mono font-semibold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300"
                  >
                    {item.algorithm} ({item.count})
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500 font-mono">None detected</span>
              )}
            </div>
          </div>
          <p className="text-2xs text-slate-500 mt-2">Highest prevalence across discovery</p>
        </div>

        {/* Card 8: Top Affected Services */}
        <div className="glass-card p-4 rounded-xl flex flex-col justify-between hover:border-slate-700 transition-colors">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Top Affected Targets
              </span>
              <Server className="w-4 h-4 text-rose-400" />
            </div>
            <div className="space-y-1 mt-2">
              {topServices.length > 0 ? (
                topServices.slice(0, 2).map((s, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-200 truncate max-w-[130px]" title={s.name}>
                      {s.name}
                    </span>
                    <span className="text-2xs uppercase font-mono text-rose-400 font-semibold">{s.severity}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-500 font-mono">No vulnerable targets</span>
              )}
            </div>
          </div>
          <p className="text-2xs text-slate-500 mt-1">Priority services for remediation</p>
        </div>
      </div>

      {/* Accessible View Toggle Bar */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
        <span className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
          Visual Risk Telemetry &amp; Distributions
        </span>
        <button
          onClick={() => setShowAccessibleTables(!showAccessibleTables)}
          className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-md transition-colors"
        >
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          <span>{showAccessibleTables ? 'Hide Accessible Tables' : 'View Accessible Data Tables'}</span>
        </button>
      </div>

      {/* 3. CHARTS GRID (2x2) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Severity Distribution */}
        <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Cryptographic Severity Distribution</h2>
              <p className="text-xs text-slate-400">Classical weakness and deprecated algorithm breakdown</p>
            </div>
            <span className="text-xs font-mono text-slate-400">{metrics.total_findings} findings</span>
          </div>

          <div className="h-60 w-full" aria-label="Donut chart showing severity distribution">
            {severityChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={severityChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {severityChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="#020617" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(value) => <span className="text-xs text-slate-300 font-mono">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No findings recorded</div>
            )}
          </div>

          {/* Accessible Table Fallback */}
          {showAccessibleTables && (
            <div className="mt-4 pt-4 border-t border-slate-800 text-xs">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="pb-1">Severity</th>
                    <th className="pb-1 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300">
                  {severityChartData.map((d) => (
                    <tr key={d.name}>
                      <td className="py-1">{d.name}</td>
                      <td className="py-1 text-right font-bold">{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Chart 2: Mosca Status Distribution */}
        <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Mosca Theorem Status Distribution</h2>
              <p className="text-xs text-slate-400">Readiness categories under {selectedScenario} horizon ($Z$)</p>
            </div>
            <span className="text-xs font-mono text-amber-400 font-semibold">{totalAtRisk} at risk</span>
          </div>

          <div className="h-60 w-full" aria-label="Bar chart showing Mosca status distribution">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moscaChartData} layout="vertical" margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={11} allowDecimals={false} />
                <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={11} width={115} fontVariant="mono" />
                <Tooltip
                  cursor={{ fill: 'rgba(255, 255, 255, 0.03)' }}
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {moscaChartData.map((entry, index) => (
                    <Cell key={`bar-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Accessible Table Fallback */}
          {showAccessibleTables && (
            <div className="mt-4 pt-4 border-t border-slate-800 text-xs">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="pb-1">Mosca Category</th>
                    <th className="pb-1 text-right">Asset Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300">
                  {moscaChartData.map((d) => (
                    <tr key={d.name}>
                      <td className="py-1">{d.name}</td>
                      <td className="py-1 text-right font-bold">{d.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Chart 3: Findings by Ingestion Source */}
        <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Findings by Ingestion Source</h2>
              <p className="text-xs text-slate-400">Telemetry origin across discovery scanners</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-cyan-400 font-mono">
              <Network className="w-3.5 h-3.5" />
              <span>Multi-vector</span>
            </div>
          </div>

          <div className="h-60 w-full" aria-label="Pie chart showing findings by source">
            {sourceChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourceChartData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name.split(' ')[0]} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {sourceChartData.map((entry, index) => (
                      <Cell key={`source-cell-${index}`} fill={entry.color} stroke="#020617" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(value) => <span className="text-xs text-slate-300 font-mono">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-500 text-xs">No multi-source data</div>
            )}
          </div>

          {/* Accessible Table Fallback */}
          {showAccessibleTables && (
            <div className="mt-4 pt-4 border-t border-slate-800 text-xs">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="pb-1">Scanner Source</th>
                    <th className="pb-1 text-right">Findings Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300">
                  {sourceChartData.map((d) => (
                    <tr key={d.name}>
                      <td className="py-1">{d.name}</td>
                      <td className="py-1 text-right font-bold">{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Chart 4: Risk & Remediation Trend */}
        <div className="glass-card p-5 rounded-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white">Cryptographic Risk Trend</h2>
              <p className="text-xs text-slate-400">Historical vulnerability progression across CBOM ingestions</p>
            </div>
            <span className="text-xs font-mono text-slate-400">{riskTrend.length} scan point(s)</span>
          </div>

          <div className="h-60 w-full" aria-label="Line chart showing risk trend over scans">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={riskTrend} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: '#334155',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Legend verticalAlign="bottom" iconType="circle" />
                <Line
                  type="monotone"
                  dataKey="critical"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  name="Critical"
                  dot={{ r: 4 }}
                />
                <Line type="monotone" dataKey="high" stroke="#f59e0b" strokeWidth={2} name="High" dot={{ r: 4 }} />
                <Line
                  type="monotone"
                  dataKey="quantum_risk"
                  stroke="#a855f7"
                  strokeWidth={2}
                  name="Quantum Risk"
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Accessible Table Fallback */}
          {showAccessibleTables && (
            <div className="mt-4 pt-4 border-t border-slate-800 text-xs">
              <table className="w-full text-left font-mono">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="pb-1">Scan Date</th>
                    <th className="pb-1 text-center">Critical</th>
                    <th className="pb-1 text-center">High</th>
                    <th className="pb-1 text-right">Quantum Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-slate-300">
                  {riskTrend.map((pt, i) => (
                    <tr key={i}>
                      <td className="py-1">{pt.date}</td>
                      <td className="py-1 text-center text-rose-400 font-bold">{pt.critical}</td>
                      <td className="py-1 text-center text-amber-400 font-bold">{pt.high}</td>
                      <td className="py-1 text-right text-purple-400 font-bold">{pt.quantum_risk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 4. TOP RISKY ASSETS TABLE */}
      <div className="glass-card p-6 rounded-2xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-400" />
              Priority Cryptographic Assets (Highest Exposure)
            </h2>
            <p className="text-xs text-slate-400">
              Assets sorted by severe classical failure or Mosca quantum deficit margin
            </p>
          </div>
          <Link
            to="/assets"
            className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <span>View Full Inventory</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {data?.top_risky_assets && data.top_risky_assets.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm font-sans">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-400 uppercase font-mono">
                  <th className="pb-3 pr-4">Primary Identifier</th>
                  <th className="pb-3 pr-4">Asset Type</th>
                  <th className="pb-3 pr-4">Highest Severity</th>
                  <th className="pb-3 pr-4">Mosca Status</th>
                  <th className="pb-3 pr-4 text-right">Margin</th>
                  <th className="pb-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data.top_risky_assets.map((asset) => (
                  <tr key={asset.asset_id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 pr-4">
                      <span
                        className="font-mono text-xs font-bold text-white truncate max-w-[240px] block"
                        title={asset.primary_identifier}
                      >
                        {asset.primary_identifier}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4 text-xs font-mono text-cyan-400 uppercase">{asset.asset_type}</td>
                    <td className="py-3.5 pr-4">
                      <SeverityBadge severity={asset.severity} size="sm" />
                    </td>
                    <td className="py-3.5 pr-4">
                      <MoscaStatusBadge status={asset.mosca_status} size="sm" />
                    </td>
                    <td className="py-3.5 pr-4 text-right font-mono text-xs font-bold">
                      <span className={asset.mosca_margin_years < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                        {asset.mosca_margin_years > 0
                          ? `+${asset.mosca_margin_years}y`
                          : `${asset.mosca_margin_years}y`}
                      </span>
                    </td>
                    <td className="py-3.5 text-right">
                      <Link
                        to={`/assets/${encodeURIComponent(asset.asset_id)}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-cyan-400 transition-colors"
                      >
                        Inspect
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-400 py-4">No risky assets detected under current filter policy.</p>
        )}
      </div>

      {/* 5. INTERACTIVE MOSCA THEOREM ANALYSIS TABLE */}
      {data?.mosca_analysis_table && data.mosca_analysis_table.length > 0 && (
        <div className="glass-card p-6 rounded-2xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400" />
                Mosca Theorem Calculus Matrix ($X + Y &gt; Z$)
              </h2>
              <p className="text-xs text-slate-400">
                Algorithm-level parameters: Shelf-life ($X$), Migration Lead Time ($Y$), Quantum Horizon ($Z$), and
                Margin
              </p>
            </div>
            <span className="text-2xs font-mono px-2.5 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800">
              Scenario: {selectedScenario}
            </span>
          </div>

          <MoscaTable rows={data.mosca_analysis_table} />
        </div>
      )}

      {/* 6. TOP MIGRATION PRIORITIES & PQC RECOMMENDATIONS */}
      {data?.recommendations && data.recommendations.length > 0 && (
        <div className="glass-card p-6 rounded-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-purple-400" />
              <div>
                <h2 className="text-base font-bold text-white">Top Post-Quantum Migration Priorities</h2>
                <p className="text-xs text-slate-400">Target architectures and classical dual-track remediations</p>
              </div>
            </div>
            <span className="text-xs font-mono text-purple-400">{data.recommendations.length} recommendations</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.recommendations.slice(0, 4).map((rec, idx) => (
              <div
                key={idx}
                className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-3 hover:border-purple-800/40 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider font-mono">
                    Target: {rec.recommended_target}
                  </span>
                  <span
                    className={`text-2xs font-mono uppercase px-2 py-0.5 rounded font-bold ${
                      rec.priority === 'critical'
                        ? 'bg-red-950 text-red-300 border border-red-800'
                        : 'bg-purple-950 text-purple-300 border border-purple-800'
                    }`}
                  >
                    {rec.priority}
                  </span>
                </div>

                <p className="text-xs text-slate-300 font-sans leading-relaxed">{rec.current_state}</p>

                {rec.classical_remediation && (
                  <div className="text-xs font-sans text-slate-400">
                    <span className="text-slate-300 font-semibold block">Classical Track:</span>
                    {rec.classical_remediation}
                  </div>
                )}

                {rec.pqc_migration && (
                  <div className="text-xs font-sans text-cyan-300/90">
                    <span className="text-cyan-400 font-semibold block">PQC Upgrade:</span>
                    {rec.pqc_migration}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-900 text-2xs font-mono text-slate-400">
                  <div>
                    <span className="text-slate-500 block">Complexity:</span>
                    <span className="text-slate-300 capitalize">{rec.migration_complexity || 'Medium'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Latency:</span>
                    <span className="text-slate-300 capitalize">{rec.latency_impact || 'Low'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Cost:</span>
                    <span className="text-slate-300 capitalize">{rec.cost_category || 'Operational'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
