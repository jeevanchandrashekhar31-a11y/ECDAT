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


  // Unified nav item class
  const navCls = (isActive: boolean) =>
    isActive ? 'nav-item-active' : 'nav-item';

  return (
    <div className="flex h-screen bg-background overflow-hidden print:h-auto" style={{ padding: '10px', gap: '10px' }}>

      {/* ━━━━━━ Floating Sidebar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <aside
        className="w-[242px] shrink-0 flex flex-col rounded-3xl z-20 print:hidden overflow-hidden"
        style={{
          background: 'rgba(6,13,28,0.85)',
          backdropFilter: 'blur(32px) saturate(200%)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%)',
          border: '1px solid rgba(255,255,255,0.065)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.04) inset',
        }}
      >
        {/* Brand */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 animate-float"
              style={{
                background: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 100%)',
                boxShadow: '0 4px 16px rgba(34,211,238,0.35), 0 1px 0 rgba(255,255,255,0.25) inset',
              }}
            >
              <Shield size={17} className="text-slate-950" strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-display font-bold text-white leading-none">ECDAT</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest"
                  style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.22)', color: '#22D3EE' }}>
                  PQC
                </span>
              </div>
              <p className="text-[10px] mt-0.5 font-medium" style={{ color: '#2A3E5A' }}>Enterprise Crypto Discovery</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {/* Eval CTA */}
          {/* Eval CTA */}
          {!currentUser ? (
            <div className="mb-3 p-1 rounded-2xl" style={{ background: 'rgba(34,211,238,0.05)', border: '1px solid rgba(34,211,238,0.1)' }}>
              <NavLink to="/login"
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-bold text-slate-950 transition-all hover:brightness-110"
                style={{ background: 'linear-gradient(90deg, #22D3EE, #6366F1)' }}>
                <ShieldCheck size={12} /> Platform Access
              </NavLink>
            </div>
          ) : currentUser.isEvaluation ? (
            <div className="mb-3 px-3 py-1.5 rounded-xl flex items-center gap-2 text-xs font-semibold"
              style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#10B981' }} />
              <span style={{ color: '#34D399' }}>Live Analytics</span>
            </div>
          ) : null}

          <p className="section-label pt-1 pb-2">Core</p>
          <NavLink to="/" end className={({ isActive }) => navCls(isActive)}><LayoutDashboard size={14} /><span>Executive Dashboard</span></NavLink>
          <NavLink to="/assets" className={({ isActive }) => navCls(isActive)}><Layers size={14} /><span>Cryptographic Assets</span></NavLink>
          <NavLink to="/findings" className={({ isActive }) => navCls(isActive)}><AlertCircle size={14} /><span>Findings</span></NavLink>

          <p className="section-label pt-4 pb-2">Governance</p>
          <NavLink to="/remediation" className={({ isActive }) => navCls(isActive)}><Wrench size={14} /><span>Remediation</span></NavLink>
          <NavLink to="/roadmap" className={({ isActive }) => navCls(isActive)}><Milestone size={14} /><span>Migration Roadmap</span></NavLink>

          <p className="section-label pt-4 pb-2">Intelligence</p>
          <NavLink to="/graph" className={({ isActive }) => navCls(isActive)}><Network size={14} /><span>Crypto Graph</span></NavLink>
          <NavLink to="/reports" className={({ isActive }) => navCls(isActive)}><FileText size={14} /><span>Compliance Reports</span></NavLink>
          <NavLink to="/login" className={({ isActive }) => navCls(isActive)}>
            <Key size={14} />
            <span>{currentUser?.isEvaluation ? 'Eval Options' : currentUser ? 'Account' : 'Sign In'}</span>
          </NavLink>

          {/* Upload CTA */}
          <div className="pt-3 mt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <button
              onClick={() => setUploadModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold"
              style={{ background: 'linear-gradient(135deg,rgba(34,211,238,0.08),rgba(99,102,241,0.08))', border: '1px solid rgba(34,211,238,0.14)', color: '#22D3EE', transition: 'all 0.2s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg,rgba(34,211,238,0.15),rgba(99,102,241,0.15))'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg,rgba(34,211,238,0.08),rgba(99,102,241,0.08))'; }}
            >
              <Upload size={12} /> New Scan / Upload
            </button>
          </div>
        </nav>

        {/* Sidebar footer */}
        <div className="px-2.5 pb-3">
          <div className="px-3 py-2.5 rounded-xl" style={{ background: 'rgba(34,211,238,0.025)', border: '1px solid rgba(34,211,238,0.06)' }}>
            <div className="flex items-center gap-2 mb-0.5">
              <ShieldCheck size={11} style={{ color: '#22D3EE' }} />
              <span className="text-xs font-semibold text-white">CycloneDX 1.6</span>
            </div>
            <p className="text-[9px] leading-snug" style={{ color: '#2A3E5A' }}>Mosca calculus · NIST PQC migration</p>
          </div>
        </div>
      </aside>

      {/* ━━━━━━ Main Panel ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div
        className="flex-1 flex flex-col min-w-0 rounded-3xl overflow-hidden relative"
        style={{
          background: 'rgba(5,12,25,0.65)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.055)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.04) inset',
        }}
      >
        {/* Ambient glows */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
          <div className="absolute -top-40 -left-20 w-80 h-80 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.05) 0%, transparent 70%)', animation: 'pulse 5s ease-in-out infinite' }} />
          <div className="absolute -bottom-40 -right-20 w-80 h-80 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.05) 0%, transparent 70%)', animation: 'float 7s ease-in-out infinite' }} />
          <div className="absolute inset-0 bg-dots opacity-20 rounded-3xl" />
        </div>



        {/* Header */}
        <header className="relative z-10 h-[52px] flex items-center justify-between px-5 shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(5,12,25,0.4)' }}>
          {/* Scan selector */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:block" style={{ color: '#2A3E5A' }}>Scan:</span>
            <div className="relative">
              <Zap className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 z-10" style={{ color: '#F59E0B' }} />
              <select
                className="pl-6 pr-5 py-1.5 text-xs font-semibold rounded-lg appearance-none cursor-pointer focus:outline-none"
                style={{ background: 'rgba(5,12,25,0.9)', border: '1px solid rgba(255,255,255,0.07)', color: '#8BA0B8', transition: 'all 0.2s' }}
                value={selectedScanId || 'all'}
                onChange={(e) => handleScanChange(e.target.value)}
              >
                <option value="all">⚡ All Scans — Consolidated</option>
                {scans.map((s) => {
                  const assetCount = s.metrics?.total_assets ?? 0;
                  // Safe date parsing — handles ISO string, epoch ms, or missing
                  let dateStr = '';
                  if (s.created_at) {
                    const d = new Date(typeof s.created_at === 'number' ? s.created_at : s.created_at);
                    dateStr = isNaN(d.getTime()) ? '' : d.toLocaleDateString();
                  }
                  const typeLabel = s.scanner_type ? `[${s.scanner_type.toUpperCase()}] ` : '';
                  return <option key={s.id} value={s.id}>{typeLabel}{s.name || s.id} — {assetCount.toLocaleString()} assets {dateStr ? `(${dateStr})` : ''}</option>;
                })}
              </select>

              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#2A3E5A' }} />
            </div>
            <button onClick={checkHealthAndScans} className="p-1.5 rounded-lg transition-colors" style={{ color: '#2A3E5A' }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#22D3EE'}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#2A3E5A'}
              title="Refresh">
              <RefreshCw size={11} />
            </button>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2">
            {currentUser?.isEvaluation ? (
              <div className="relative">
                <button onClick={() => setPersonaDropdownOpen(!personaDropdownOpen)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.16)', color: '#34D399' }}>
                  <ShieldCheck size={11} /><span>{currentUser.displayName}</span>
                  <ChevronDown size={10} className={`transition-transform duration-200 ${personaDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {personaDropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl py-1.5 z-50"
                    style={{ background: '#050C19', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 60px rgba(0,0,0,0.7)' }}>
                    <div className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold" style={{ color: '#2A3E5A', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>Switch Persona</div>
                    {[
                      { label: 'Security Analyst', fn: async () => { await api.switchEvaluationPersona('analyst'); window.location.reload(); } },
                      { label: 'Security Approver', fn: async () => { const c = window.prompt('Approver Passcode:'); if (c) { try { await api.switchEvaluationPersona('approver', c); window.location.reload(); } catch (e: any) { alert(e.message); } } } },
                      { label: 'Executive Viewer', fn: async () => { const c = window.prompt('Executive Passcode:'); if (c) { try { await api.switchEvaluationPersona('executive', c); window.location.reload(); } catch (e: any) { alert(e.message); } } } },
                    ].map(({ label, fn }) => (
                      <button key={label} onClick={fn} className="w-full text-left px-4 py-2.5 text-xs transition-all" style={{ color: '#8BA0B8' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(34,211,238,0.05)'; (e.currentTarget as HTMLButtonElement).style.color = '#22D3EE'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = '#8BA0B8'; }}>
                        {label}
                      </button>
                    ))}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', margin: '4px 0' }} />
                    <button onClick={async () => { if (window.confirm('Reset Workspace?')) { await api.resetEvaluationTenant(); window.location.reload(); } }}
                      className="w-full text-left px-4 py-2.5 text-xs font-semibold" style={{ color: '#F59E0B' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.05)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = ''}>Reset Workspace</button>
                    <button onClick={() => { authManager.clearSession(); window.location.href = '/login'; }}
                      className="w-full text-left px-4 py-2.5 text-xs font-semibold" style={{ color: '#FB7185' }}
                      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(244,63,94,0.05)'}
                      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = ''}>Sign Out</button>
                  </div>
                )}
              </div>
            ) : (
              <NavLink to="/login"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#8BA0B8' }}>
                {currentUser ? <><UserCheck size={11} /><span>{currentUser.username}</span></> : <><ShieldCheck size={11} /><span>Sign In</span></>}
              </NavLink>
            )}
            <StatusIndicator online={engineOnline} version={engineVersion} />
          </div>
        </header>

        {/* Security alert */}
        {securityAlert && location.pathname !== '/login' && (
          <div className="relative z-10 px-5 py-2 flex items-center justify-between text-xs"
            style={{ background: 'rgba(244,63,94,0.07)', borderBottom: '1px solid rgba(244,63,94,0.15)', color: '#FCA5A5' }}>
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} style={{ color: '#F43F5E' }} />
              <span className="font-bold text-white">Security Alert ({securityAlert.status}):</span>
              <span>{securityAlert.message}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/login')} className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                style={{ background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.25)' }}>Authenticate</button>
              <button onClick={() => setSecurityAlert(null)} style={{ color: '#2A3E5A' }}><X size={12} /></button>
            </div>
          </div>
        )}

        {/* Page Content — key triggers spring re-entry on every route change */}
        <main
          key={location.pathname}
          className="flex-1 overflow-y-auto relative z-10 animate-page-in print:overflow-visible"
          style={{ padding: '0' }}
        >
          {children || <Outlet context={{ selectedScanId, scans, onUploadSuccess: handleUploadSuccess }} />}
        </main>
      </div>

      {/* Upload Modal */}
      <CbomUploadModal isOpen={uploadModalOpen} onClose={() => setUploadModalOpen(false)} onSuccess={handleUploadSuccess} />
    </div>
  );
};
