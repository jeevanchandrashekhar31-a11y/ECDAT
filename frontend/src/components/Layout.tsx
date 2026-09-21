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
  Network,
  AlertTriangle,
  AlertCircle,
  UserCheck,
  Wrench,
} from 'lucide-react';
import { api } from '../api/client';
import { authManager } from '../security';
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
  const [currentUser, setCurrentUser] = useState<{
    userId?: string;
    username?: string;
    roles?: string[];
    role?: string;
    tenantId?: string;
    isDemo?: boolean;
  } | null>(null);
  const [securityAlert, setSecurityAlert] = useState<{ status: number; message: string } | null>(null);
  const [currentRole, setCurrentRole] = useState<string>(authManager.getSession().role || 'Viewer');

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

  const checkUserSession = async () => {
    try {
      const res = await api.getCurrentUser();
      if (res && res.user) {
        const primaryRole = (res.user.roles && res.user.roles[0]) || 'Viewer';
        const isDemo = res.user.tenantId === 'demo-tenant' || res.user.isDemo;
        setCurrentUser({
          userId: res.user.userId,
          username: res.user.username || res.user.userId,
          roles: res.user.roles,
          role: primaryRole,
          tenantId: res.user.tenantId,
          isDemo,
        });
        setCurrentRole(primaryRole);
        authManager.setSession({
          userId: res.user.userId,
          role: primaryRole as any,
          tenantId: res.user.tenantId,
          isAuthenticated: true,
        });
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    checkHealthAndScans();
    checkUserSession();
    setCurrentRole(authManager.getSession().role || 'Viewer');

    const unsub401 = authManager.onUnauthorized((session, err) => {
      setSecurityAlert({
        status: 401,
        message: err?.message || 'Session expired or unauthenticated. Please log in.',
      });
      setCurrentRole(session.role || 'Viewer');
      setCurrentUser(null);
    });

    const unsub403 = authManager.onForbidden((session, err) => {
      setSecurityAlert({
        status: 403,
        message: err?.message || 'Access denied (403 Forbidden). Insufficient permissions for requested operation.',
      });
      setCurrentRole(session.role || 'Viewer');
    });

    return () => {
      unsub401();
      unsub403();
    };
  }, [location.pathname]);

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
            to="/findings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <AlertCircle size={17} />
            <span>Findings</span>
          </NavLink>

          <NavLink
            to="/remediation"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <Wrench size={17} />
            <span>Remediation</span>
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
            to="/graph"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <Network size={17} />
            <span>Crypto Graph</span>
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

          <NavLink
            to="/login"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-semibold transition-all ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20 font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`
            }
          >
            <Key size={17} />
            <span>Authentication & MFA</span>
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
        {/* Demo Mode Persistent Banner */}
        {currentUser?.tenantId === 'demo-tenant' && (
          <div className="bg-gradient-to-r from-amber-500/15 via-cyan-500/10 to-indigo-500/15 border-b border-amber-500/40 px-6 py-2 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold text-2xs uppercase border border-amber-500/40">
                Demo Environment — synthetic dataset
              </span>
              <span className="text-slate-300 text-xs hidden sm:inline">
                Tenant: <code className="text-cyan-300 font-mono">demo-tenant</code> (Constrained Session — No Cross-Tenant Access)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <NavLink
                to="/remediation"
                className="px-2.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold text-2xs transition-colors border border-amber-500/30"
              >
                Four-Eyes Remediation
              </NavLink>
            </div>
          </div>
        )}

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
            {/* RBAC Role Indicator */}
            <div
              className="px-2.5 py-1 rounded-lg text-2xs font-mono font-bold bg-cyan-950/60 text-cyan-300 border border-cyan-800/50 flex items-center gap-1.5"
              title="Active client-side RBAC authorization tier"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span>Role: {currentRole}</span>
            </div>

            {/* User Session / Login Button */}
            <NavLink
              to="/login"
              className={({ isActive }) =>
                `inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                    : currentUser
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                }`
              }
              title="Authentication & MFA Management"
            >
              {currentUser ? <UserCheck size={13} /> : <Key size={13} />}
              <span>{currentUser ? `${currentUser.username}` : 'Sign In'}</span>
            </NavLink>

            {/* Core Status */}
            <StatusIndicator online={engineOnline} version={engineVersion} />
          </div>
        </header>

        {/* Security Alert Interceptor Banner */}
        {securityAlert && (
          <div className="bg-rose-950/90 border-b border-rose-500/60 px-6 py-2.5 flex items-center justify-between text-xs text-rose-200 animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-2.5">
              <div className="p-1 rounded-md bg-rose-900/60 text-rose-400 border border-rose-700/50">
                <AlertTriangle size={15} />
              </div>
              <span className="font-bold text-white tracking-wide">
                Security Defense Alert ({securityAlert.status}):
              </span>
              <span className="text-rose-300">{securityAlert.message}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/login')}
                className="px-3 py-1 rounded bg-rose-900/80 hover:bg-rose-800 text-rose-100 font-semibold text-2xs transition-colors border border-rose-700"
              >
                Authenticate Now
              </button>
              <button
                onClick={() => setSecurityAlert(null)}
                className="p-1 text-rose-400 hover:text-white transition-colors"
                title="Dismiss alert"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

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
    </div>
  );
};
