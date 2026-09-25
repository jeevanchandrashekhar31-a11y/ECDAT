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
    isEvaluation?: boolean;
    displayName?: string;
  } | null>(null);
  const [securityAlert, setSecurityAlert] = useState<{ status: number; message: string } | null>(null);

  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);

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
    // Attempt session hydration if credentials exist
    const hasCredentials = !!localStorage.getItem('ecdat_api_key') || !!sessionStorage.getItem('ecdat_auth_token');
    if (!hasCredentials && !authManager.getSession().isAuthenticated) {
      setCurrentUser(null);
      return;
    }
    
    try {
      const res = await api.getCurrentUser();
      if (res && res.user) {
        const primaryRole = (res.user.roles && res.user.roles[0]) || 'Viewer';
        const isDemo = res.user.tenantId === 'demo-tenant' || res.user.isDemo;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = res.user as any;
        const activeUserId = u.userId || u.sub || u.id || 'unknown-user';
        setCurrentUser({
          userId: activeUserId,
          username: res.user.username || activeUserId,
          roles: res.user.roles,
          role: primaryRole,
          tenantId: res.user.tenantId,
          isDemo,
        });

        authManager.setSession({
          userId: activeUserId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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


    const unsub401 = authManager.onUnauthorized((_session, err) => {

      setCurrentUser(null);
      if (location.pathname !== '/login') {
        setSecurityAlert({
          status: 401,
          message: err?.message || 'Session expired or unauthenticated. Please log in.',
        });
        navigate('/login');
      }
    });

    const unsub403 = authManager.onForbidden((_session, err) => {
      setSecurityAlert({
        status: 403,
        message: err?.message || 'Access denied (403 Forbidden). Insufficient permissions for requested operation.',
      });

    });

    return () => {
      unsub401();
      unsub403();
    };
  }, [location.pathname]);

  // Synchronize state when URL changes (only apply if URL explicitly overrides it)
  useEffect(() => {
    const urlScanId = new URLSearchParams(location.search).get('scanId');
    if (urlScanId && urlScanId !== selectedScanId) {
      setSelectedScanId(urlScanId);
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
    <div className="flex h-screen print:h-auto bg-background text-slate-100 font-sans selection:bg-primary/20 selection:text-primary">
      {/* Sidebar Navigation */}
      <aside className="w-64 glass-panel m-4 flex flex-col z-20 overflow-hidden shrink-0 print:hidden">
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
          {/* Prominent Evaluation Entry Badge/Button */}
          {!currentUser ? (
            <div className="mb-3 p-2 rounded-xl bg-gradient-to-r from-amber-500/15 via-cyan-500/15 to-indigo-500/15 border border-amber-500/30 text-center">
              <NavLink
                to="/login"
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-cyan-500 text-slate-950 font-bold text-xs shadow-md shadow-amber-500/20 hover:brightness-110 transition-all"
              >
                <ShieldCheck size={15} />
                <span>Enter Evaluation Environment</span>
              </NavLink>
            </div>
          ) : currentUser.isEvaluation ? (
            <div className="mb-3 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-between text-2xs text-emerald-300 font-semibold">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Evaluation Active
              </span>
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
            <span>{currentUser?.isEvaluation ? 'Evaluation Options' : (currentUser ? 'Account Options' : 'Enter Evaluation / Sign In')}</span>
          </NavLink>

          <div className="pt-4 mt-4 border-t border-slate-800/80">
            <button
              onClick={() => setUploadModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-bold transition-all shadow-sm"
            >
              <Upload size={16} />
              <span>New Scan / Upload</span>
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

        {/* Evaluation Environment Persistent Banner */}
        {currentUser?.isEvaluation && (
          <div className="bg-gradient-to-r from-indigo-950 via-cyan-950/60 to-indigo-950 border-b border-indigo-500/40 px-6 py-2 flex items-center justify-center text-xs text-indigo-200">
            <span className="font-semibold">
              Evaluation Environment · Synthetic data · No production systems connected
            </span>
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

            {/* Persona Switcher / User Session */}
            {currentUser?.isEvaluation ? (
              <div className="relative">
                <button
                  onClick={() => setPersonaDropdownOpen(!personaDropdownOpen)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer"
                >
                  <ShieldCheck size={13} className="text-emerald-400" />
                  <span>{currentUser.displayName} ▾</span>
                </button>
                {/* Dropdown */}
                {personaDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-56 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 py-1">
                  <div className="px-3 py-2 border-b border-slate-800 text-2xs uppercase tracking-wider text-slate-500 font-bold">
                    Evaluation Environment ▾
                  </div>
                  <button
                    onClick={async () => {
                      await api.switchEvaluationPersona('analyst');
                      window.location.reload();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-cyan-400"
                  >
                    Security Analyst
                  </button>
                  <button
                    onClick={async () => {
                      await api.switchEvaluationPersona('approver');
                      window.location.reload();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-cyan-400"
                  >
                    Security Approver
                  </button>
                  <button
                    onClick={async () => {
                      await api.switchEvaluationPersona('executive');
                      window.location.reload();
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-cyan-400"
                  >
                    Executive Viewer
                  </button>
                  <div className="border-t border-slate-800 my-1"></div>
                  <div className="px-4 py-2 text-xs text-indigo-400 hover:bg-slate-800 font-semibold cursor-pointer">
                    Evaluation Guide
                  </div>
                  <button
                    onClick={async () => {
                      if (window.confirm("Reset Evaluation Environment?\n\nThis will restore the evaluation environment to its clean starting state.\n\nProduction data is not affected.")) {
                        await api.resetEvaluationTenant();
                        window.location.reload();
                      }
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-amber-400 hover:bg-slate-800 font-semibold"
                  >
                    Reset Evaluation
                  </button>
                  <button
                    onClick={async () => {
                      authManager.clearSession();
                      window.location.href = '/login';
                    }}
                    className="w-full text-left px-4 py-2 text-xs text-rose-400 hover:bg-slate-800 font-semibold"
                  >
                    Exit Evaluation
                  </button>
                </div>
                )}
              </div>
            ) : (
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      : currentUser
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/25'
                      : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30 font-bold shadow-sm'
                  }`
                }
              >
                {currentUser ? (
                  <>
                    <UserCheck size={13} />
                    <span>{currentUser.username}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={13} className="text-indigo-400" />
                    <span>Enter Evaluation</span>
                  </>
                )}
              </NavLink>
            )}

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
        <main className="flex-1 p-6 overflow-y-auto print:overflow-visible print:h-auto">
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
