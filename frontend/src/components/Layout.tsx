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
  Zap,
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

    if (!authManager.getSession().isAuthenticated) {
      setScans([]);
      return;
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
    if (!authManager.getSession().isAuthenticated) {
      setCurrentUser(null);
      return;
    }
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
        setSecurityAlert(null); // Clear any stale alerts on successful auth
      } else {
        setCurrentUser(null);
      }
    } catch {
      setCurrentUser(null);
    }
  };

  useEffect(() => {
    // removed automatic clear of securityAlert on /login to preserve 401 messages
    checkHealthAndScans();
    checkUserSession();
    setCurrentRole(authManager.getSession().role || 'Viewer');

    const unsub401 = authManager.onUnauthorized((session, err) => {
      setCurrentRole(session.role || 'Viewer');
      setCurrentUser(null);
      if (location.pathname !== '/login') {
        setSecurityAlert({
          status: 401,
          message: err?.message || 'Session expired or unauthenticated. Please log in.',
        });
        navigate('/login');
      }
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
  }, [location.search, selectedScanId]);

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
    <div className="flex h-screen bg-background text-slate-100 font-sans selection:bg-primary/20 selection:text-primary">
      {/* Sidebar Navigation */}
      <aside className="w-64 glass-panel m-4 flex flex-col z-20 overflow-hidden shrink-0">
        {/* Branding */}
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-secondary shadow-lg shadow-primary/20 text-white flex-shrink-0">
              <Shield size={24} className="animate-float" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-display font-bold tracking-tight text-white m-0 leading-none">
                  ECDAT
                </h1>
                <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-primary/20 border border-primary/30 text-primary font-bold uppercase tracking-wider">
                  PQC
                </span>
              </div>
              <p className="text-[10px] text-slate-400 mt-1 font-medium tracking-wide">Enterprise Crypto Discovery</p>
            </div>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="p-4 space-y-1.5 flex-1 text-xs">
          {/* Prominent Demo Entry Badge/Button */}
          {!currentUser ? (
            <div className="mb-3 p-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-cyan-500/15 to-indigo-500/15 border border-amber-500/30 text-center">
              <NavLink
                to="/login"
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-cyan-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 hover:brightness-110 transition-all"
              >
                <ShieldCheck size={15} />
                <span>Enter Demo Mode (1-Click)</span>
              </NavLink>
            </div>
          ) : currentUser.isDemo ? (
            <div className="mb-3 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-between text-2xs text-emerald-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Judge Demo Active
              </span>
              <span className="font-mono text-emerald-400/80">demo-tenant</span>
            </div>
          ) : null}

          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surfaceHover/50'
              }`
            }
          >
            <LayoutDashboard size={17} />
            <span>Executive Dashboard</span>
          </NavLink>

          <NavLink
            to="/assets"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surfaceHover/50'
              }`
            }
          >
            <Layers size={17} />
            <span>Cryptographic Assets</span>
          </NavLink>

          <NavLink
            to="/findings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surfaceHover/50'
              }`
            }
          >
            <AlertCircle size={17} />
            <span>Findings</span>
          </NavLink>

          <NavLink
            to="/remediation"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surfaceHover/50'
              }`
            }
          >
            <Wrench size={17} />
            <span>Remediation</span>
          </NavLink>

          <NavLink
            to="/roadmap"
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium transition-all duration-300 ${
                isActive
                  ? 'bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surfaceHover/50'
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
            <span>{currentUser?.isDemo ? 'Demo Mode & Auth' : (currentUser ? 'User Session & MFA' : 'Enter Demo / Sign In')}</span>
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Background glow effects */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] pointer-events-none" />

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
        <header className="h-16 glass-panel rounded-none border-t-0 border-x-0 border-b border-border/50 flex items-center justify-between px-6 z-10 sticky top-0">
          {/* Active Scan Selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Scan:</span>
            <div className="relative">
              <Zap className="w-3.5 h-3.5 text-amber-400 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
              <select
                className="pl-9 pr-8 py-2 bg-slate-800/50 border border-slate-700/50 text-slate-200 text-xs font-semibold rounded-lg appearance-none cursor-pointer hover:bg-slate-800/80 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                value={selectedScanId || 'all'}
                onChange={(e) => handleScanChange(e.target.value)}
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
                    : currentUser?.isDemo
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                    : currentUser
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 font-bold shadow-sm'
                }`
              }
              title="Enter Demo Mode or Manage Session"
            >
              {currentUser?.isDemo ? (
                <>
                  <ShieldCheck size={13} className="text-emerald-400" />
                  <span>Demo Mode Active</span>
                </>
              ) : currentUser ? (
                <>
                  <UserCheck size={13} />
                  <span>{currentUser.username}</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={13} className="text-amber-400" />
                  <span>Enter Demo Mode</span>
                </>
              )}
            </NavLink>

            {/* Core Status */}
            <StatusIndicator online={engineOnline} version={engineVersion} />
          </div>
        </header>

        {/* Security Alert Interceptor Banner */}
        {securityAlert && location.pathname !== '/login' && (
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
