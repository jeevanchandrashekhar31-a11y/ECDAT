import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Shield,
  LayoutDashboard,
  Layers,
  Milestone,
  FileText,
  Upload,
  Key,
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  X,
} from 'lucide-react';
import { api, getSessionApiKey, setSessionApiKey } from '../api/client';
import { StatusIndicator } from './StatusIndicator';
import { CbomUploadModal } from './CbomUploadModal';
import { ScanItem } from '../types';

interface LayoutProps {
  children?: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const [engineOnline, setEngineOnline] = useState(true);
  const [engineVersion, setEngineVersion] = useState<string | undefined>();
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string>('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Check health and fetch scans list
  const checkHealthAndScans = async () => {
    try {
      const health = await api.getHealth();
      setEngineOnline(health.status === 'healthy');
      setEngineVersion(health.version);
    } catch {
      setEngineOnline(false);
    }

    try {
      const scansRes = await api.getScans();
      const list = scansRes.scans || [];
      setScans(list);
      const urlScanId = new URLSearchParams(window.location.search).get('scanId');
      if (urlScanId) {
        setSelectedScanId(urlScanId);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    checkHealthAndScans();
    const stored = getSessionApiKey();
    setSavedKey(stored);
    setApiKeyInput(stored || '');
  }, []);

  // Synchronize state when URL changes
  useEffect(() => {
    const urlScanId = new URLSearchParams(location.search).get('scanId');
    if (urlScanId) {
      if (urlScanId !== selectedScanId) {
        setSelectedScanId(urlScanId);
      }
    } else if (selectedScanId !== 'all') {
      setSelectedScanId('all');
    }
  }, [location.search]);

  // Update selected scan query param when scan changes
  const handleScanChange = (newScanId: string) => {
    setSelectedScanId(newScanId);
    const searchParams = new URLSearchParams(location.search);
    if (newScanId && newScanId !== 'all') {
      searchParams.set('scanId', newScanId);
    } else {
      searchParams.delete('scanId');
    }
    navigate({ pathname: location.pathname, search: searchParams.toString() });
  };

  const handleSaveApiKey = (e: React.FormEvent) => {
    e.preventDefault();
    setSessionApiKey(apiKeyInput);
    setSavedKey(apiKeyInput.trim() || null);
    setKeyModalOpen(false);
  };

  const handleUploadSuccess = async (newScanId: string) => {
    setSelectedScanId(newScanId);
    const searchParams = new URLSearchParams(location.search);
    if (newScanId && newScanId !== 'all') {
      searchParams.set('scanId', newScanId);
    } else {
      searchParams.delete('scanId');
    }
    navigate({ pathname: location.pathname, search: searchParams.toString() });

    try {
      const scansRes = await api.getScans();
      setScans(scansRes.scans || []);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex text-slate-100">
      {/* 1. Left Sidebar Navigation */}
      <aside className="w-64 bg-slate-900/90 border-r border-slate-800/80 flex flex-col shrink-0">
        {/* Brand Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 text-slate-950 shadow-lg shadow-cyan-500/20">
              <Shield size={22} className="stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold tracking-tight text-white text-base">ECDAT</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-semibold uppercase">
                  PQC
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Crypto Discovery & Mosca</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1.5 flex-1 text-xs">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <LayoutDashboard size={17} />
            <span>Executive Dashboard</span>
          </NavLink>

          <NavLink
            to="/assets"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <Layers size={17} />
            <span>Cryptographic Assets</span>
          </NavLink>

          <NavLink
            to="/roadmap"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <Milestone size={17} />
            <span>Migration Roadmap</span>
          </NavLink>

          <NavLink
            to="/reports"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <FileText size={17} />
            <span>Compliance Reports</span>
          </NavLink>

          <div className="pt-4 mt-4 border-t border-slate-800/80">
            <button
              onClick={() => setUploadModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-bold transition-all shadow-sm"
            >
              <Upload size={16} />
              <span>Ingest New CBOM</span>
            </button>
          </div>
        </nav>

        {/* Sidebar Footer Info */}
        <div className="p-4 border-t border-slate-800/80 text-xs">
          <div className="glass-card p-3 bg-slate-950/60">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <ShieldCheck size={14} className="text-cyan-400" />
              <span className="font-semibold text-slate-200">CycloneDX 1.6</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-tight">
              Rule-based cryptographic inventory with Mosca calculus.
            </p>
          </div>
        </div>
      </aside>

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-16 bg-slate-900/60 backdrop-blur-md border-b border-slate-800/80 px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          {/* Active Scan Selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Scan:</span>
            <div className="relative">
              <select
                value={selectedScanId || 'all'}
                onChange={(e) => handleScanChange(e.target.value)}
                className="appearance-none bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-lg pl-3 pr-8 py-1.5 text-xs font-medium focus:outline-none focus:border-cyan-500 cursor-pointer min-w-[290px]"
              >
                <option value="all">⚡ All Scans (Consolidated Enterprise Portfolio)</option>
                {scans.map((s) => {
                  const assetCount = s.metrics?.total_assets ?? 0;
                  const dateStr = s.created_at ? new Date(s.created_at).toLocaleDateString() : '';
                  const typeLabel = s.scanner_type ? `[${s.scanner_type.toUpperCase()}] ` : '';
                  return (
                    <option key={s.id} value={s.id}>
                      {typeLabel}{s.name || s.id} — {assetCount.toLocaleString()} assets {dateStr ? `(${dateStr})` : ''}
                    </option>
                  );
                })}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>

            <button
              onClick={checkHealthAndScans}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              title="Refresh telemetry"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-3">
            {/* API Key Modal Button */}
            <button
              onClick={() => setKeyModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                savedKey
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Configure API key for write routes"
            >
              <Key size={13} />
              <span>{savedKey ? 'API Key Active' : 'Configure API Key'}</span>
            </button>

            {/* Core Status */}
            <StatusIndicator online={engineOnline} version={engineVersion} />
          </div>
        </header>

        {/* Routed Page Content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {children || <Outlet context={{ selectedScanId, scans, onUploadSuccess: handleUploadSuccess }} />}
        </main>
      </div>

      {/* 3. Ingest Modal */}
      <CbomUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
      />

      {/* 4. API Key Configuration Modal */}
      {keyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="glass-card max-w-md w-full p-6 relative">
            <button
              onClick={() => setKeyModalOpen(false)}
              className="absolute top-4 right-4 p-1.5 text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="p-2 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-400">
                <Key size={20} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">API Authentication Key</h3>
                <p className="text-xs text-slate-400">Stored only in your browser session for write requests</p>
              </div>
            </div>

            <form onSubmit={handleSaveApiKey} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">ECDAT Admin API Key (`ECDAT_API_KEY`)</label>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="e.g. ecdat-demo-admin-key-2026"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-cyan-500"
                />
                <p className="text-slate-500 text-[11px] mt-1">
                  Default development key: <code className="text-cyan-400 font-mono font-bold">ecdat-demo-admin-key-2026</code>
                </p>
              </div>

              <div className="flex justify-between items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSessionApiKey('ecdat-demo-admin-key-2026');
                    setSavedKey('ecdat-demo-admin-key-2026');
                    setApiKeyInput('ecdat-demo-admin-key-2026');
                    setKeyModalOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 text-2xs font-medium"
                >
                  Reset to Default
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setKeyModalOpen(false)}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                  >
                    Save Key
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
