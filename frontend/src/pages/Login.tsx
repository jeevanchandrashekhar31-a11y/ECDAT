import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  Lock,
  CheckCircle,
  AlertCircle,
  Smartphone,
  Copy,
  LogOut,
  RefreshCw,
  UserCheck,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { api } from '../api/client';
import {
  authManager,
  UserRole,
  setCsrfToken,
  clearCsrfToken,
} from '../security';

export const Login: React.FC = () => {
  const navigate = useNavigate();

  // Authentication Step State
  const [step, setStep] = useState<'login' | 'mfa_challenge' | 'authenticated'>('login');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Login Form
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // MFA Challenge Form (during login)
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [isBackupCode, setIsBackupCode] = useState(false);

  // Current Session Info
  const [sessionUser, setSessionUser] = useState<{
    userId?: string;
    username?: string;
    email?: string;
    role?: string;
    tenantId?: string;
  } | null>(null);

  // MFA Enrollment State (for authenticated user)
  const [mfaSetupData, setMfaSetupData] = useState<{
    secret: string;
    otpAuthUri: string;
    issuer: string;
    backupCodes: string[];
    instructions: string;
  } | null>(null);
  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Check current session on mount via HTTP-only cookie /me
  useEffect(() => {
    checkCurrentUser();
  }, []);

  const checkCurrentUser = async () => {
    try {
      const me = await api.getCurrentUser();
      if (me && me.authenticated) {
        setSessionUser({
          userId: me.user?.userId,
          username: me.user?.username,
          email: me.user?.email,
          role: me.role,
          tenantId: me.user?.tenantId,
        });
        authManager.setSession({
          userId: me.user?.userId,
          tenantId: me.user?.tenantId,
          role: (me.role as UserRole) || 'Viewer',
          isAuthenticated: true,
        });
        setStep('authenticated');
      }
    } catch {
      // Unauthenticated state
      setStep('login');
    }
  };

  // 0. 1-Click Evaluation Environment Login
  const handleEnterEvaluation = async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api.enterEvaluation('analyst');
      // HTTP-Only cookies are used for access tokens
      if (res.csrfToken) {
        setCsrfToken(res.csrfToken);
      }
      if (res.user) {
        setSessionUser({
          userId: res.user.userId,
          username: res.user.username,
          email: res.user.email,
          role: res.user.roles?.[0],
          tenantId: res.user.tenantId,
        });
        authManager.setSession({
          userId: res.user.userId,
          tenantId: res.user.tenantId,
          role: (res.user.roles?.[0] as UserRole) || 'Analyst',
          isAuthenticated: true,
        });
      }
      setStep('authenticated');
      setSuccessMsg('Entered Evaluation Environment. Redirecting to Executive Dashboard...');
      setTimeout(() => navigate('/'), 400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Evaluation login failed.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // 1. Submit Credentials to /api/v1/auth/local/login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.login(username.trim(), password);

      if (res.mfaRequired) {
        setMfaToken(res.mfaToken || null);
        setStep('mfa_challenge');
        setSuccessMsg('Primary authentication successful. Please enter your 6-digit MFA code.');
      } else {
        // HTTP-Only cookies are used for access tokens
        if (res.csrfToken) {
          setCsrfToken(res.csrfToken);
        }
        if (res.user) {
          setSessionUser({
            userId: res.user.userId,
            username: res.user.username,
            email: res.user.email,
            role: res.user.roles?.[0],
            tenantId: res.user.tenantId,
          });
          authManager.setSession({
            userId: res.user.userId,
            tenantId: res.user.tenantId,
            role: (res.user.roles?.[0] as UserRole) || 'Viewer',
            isAuthenticated: true,
          });
        }
        setStep('authenticated');
        setSuccessMsg('Successfully authenticated via secure HTTP-only session cookies.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed. Please verify credentials.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // 2. Submit MFA Challenge to /api/v1/auth/mfa/verify
  const handleMfaVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) {
      setErrorMsg('MFA challenge session expired. Please sign in again.');
      setStep('login');
      return;
    }
    if (!mfaCode.trim()) {
      setErrorMsg('Please enter your verification code.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await api.mfaVerify(mfaToken, mfaCode.trim(), isBackupCode);

      // HTTP-Only cookies are used for access tokens
      if (res.csrfToken) {
        setCsrfToken(res.csrfToken);
      }
      if (res.user) {
        setSessionUser({
          userId: res.user.userId,
          username: res.user.username,
          email: res.user.email,
          role: res.user.roles?.[0],
        });
        authManager.setSession({
          userId: res.user.userId,
          role: (res.user.roles?.[0] as UserRole) || 'Viewer',
          isAuthenticated: true,
        });
      }
      setStep('authenticated');
      setSuccessMsg('MFA verification successful. Session established via secure cookies.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid MFA code. Please try again.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // 3. Initiate MFA Setup (Enrollment) via /api/v1/auth/mfa/setup
  const handleStartMfaEnrollment = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.mfaSetup();
      setMfaSetupData({
        secret: res.secret,
        otpAuthUri: res.otpAuthUri,
        issuer: res.issuer,
        backupCodes: res.backupCodes || [],
        instructions: res.instructions,
      });
      setSuccessMsg('MFA enrollment initiated. Scan the QR code or enter the secret below.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initiate MFA setup.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // 4. Confirm MFA Setup via /api/v1/auth/mfa/enable
  const handleConfirmMfaEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollmentCode.trim()) {
      setErrorMsg('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await api.mfaEnable(enrollmentCode.trim());
      if (res.success) {
        setMfaSetupData(null);
        setEnrollmentCode('');
        setSuccessMsg('Multi-factor authentication (MFA) successfully enabled on your account.');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to verify enrollment code.';
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  // 5. Logout via /api/v1/auth/logout
  const handleLogout = async () => {
    setLoading(true);
    try {
      await api.logout();
    } catch {
      // Best-effort
    } finally {
      authManager.clearSession();
      clearCsrfToken();
      setSessionUser(null);
      setStep('login');
      setUsername('');
      setPassword('');
      setMfaToken(null);
      setMfaCode('');
      setLoading(false);
      setSuccessMsg('Logged out successfully. Cookies and session cleared.');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">

      {/* ── Animated background orbs ──────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full animate-pulse-slow" style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)' }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full animate-float" style={{ background: 'radial-gradient(circle, rgba(129,140,248,0.08) 0%, transparent 70%)' }} />
        <div className="absolute top-[40%] right-[25%] w-[300px] h-[300px] rounded-full animate-float-delayed" style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, transparent 70%)' }} />
        {/* Subtle grid */}
        <div className="absolute inset-0 bg-grid opacity-40" />
      </div>

      {/* ── Left: Hero Panel ──────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 relative">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #22D3EE, #6366F1)', boxShadow: '0 4px 20px rgba(34,211,238,0.35)' }}
          >
            <Shield size={22} className="text-slate-950" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-display font-bold text-white">ECDAT</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest" style={{ background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.25)', color: '#22D3EE' }}>PQC</span>
            </div>
          </div>
        </div>

        {/* Hero text */}
        <div className="animate-slide-up">
          <div className="mb-6">
            <span className="badge badge-primary mb-4">Enterprise Cryptographic Security</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-white leading-tight mb-4">
            Quantum-Ready<br />
            <span className="gradient-text">Cryptographic</span><br />
            Intelligence
          </h1>
          <p className="text-slate-400 text-base leading-relaxed mb-8 max-w-sm">
            Discover, assess, and migrate your cryptographic assets before quantum computers break them. CBOM generation, Mosca theorem calculus, and PQC migration planning.
          </p>

          {/* Feature pills */}
          <div className="space-y-3">
            {[
              { icon: '🔍', label: 'Real-time CBOM generation & inventory' },
              { icon: '⚛️', label: 'Mosca theorem quantum-risk horizon calculus' },
              { icon: '🛡️', label: 'Post-quantum cryptography migration roadmaps' },
              { icon: '📋', label: 'NIST, FIPS 140-3, PCI-DSS compliance reporting' },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="text-base">{f.icon}</span>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-slate-600">
          CycloneDX 1.6 · NIST SP 800-208 · Mosca Theorem · RFC 6238 MFA
        </p>
      </div>

      {/* ── Right: Auth Panel ─────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md animate-slide-up">

          {/* Mobile brand (lg:hidden) */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #22D3EE, #6366F1)', boxShadow: '0 4px 16px rgba(34,211,238,0.3)' }}>
              <Shield size={20} className="text-slate-950" />
            </div>
            <span className="text-xl font-display font-bold text-white">ECDAT</span>
          </div>

          {/* Alerts */}
          {errorMsg && (
            <div className="mb-5 p-4 rounded-xl flex items-start gap-3 text-sm animate-slide-up" style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.25)', color: '#FCA5A5' }}>
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-danger" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="mb-5 p-4 rounded-xl flex items-start gap-3 text-sm animate-slide-up" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: '#6EE7B7' }}>
              <CheckCircle size={16} className="shrink-0 mt-0.5 text-accent" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* STEP 1: Login */}
          {step === 'login' && (
            <div className="space-y-4">
              {/* Evaluation card */}
              <div
                className="p-7 rounded-2xl relative overflow-hidden"
                style={{ background: 'rgba(12,24,41,0.8)', border: '1px solid rgba(34,211,238,0.15)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
              >
                {/* Corner badge */}
                <div className="absolute top-4 right-4">
                  <span className="badge badge-primary uppercase tracking-widest">Evaluation</span>
                </div>

                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 pointer-events-none rounded-2xl" style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.04) 0%, rgba(99,102,241,0.04) 100%)' }} />

                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-xl mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.15), rgba(99,102,241,0.15))', border: '1px solid rgba(34,211,238,0.2)' }}>
                    <ShieldCheck size={22} className="text-primary" />
                  </div>

                  <h2 className="text-xl font-display font-bold text-white mb-2">Enter Evaluation Environment</h2>
                  <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                    Explore cryptographic discovery, CBOM, PQC assessment, and remediation workflows using realistic synthetic data. No production systems connected.
                  </p>

                  <button
                    type="button"
                    onClick={handleEnterEvaluation}
                    disabled={loading}
                    className="w-full py-3.5 px-5 rounded-xl font-bold text-slate-950 text-sm flex items-center justify-center gap-2.5 transition-all duration-200 group disabled:opacity-60"
                    style={{ background: 'linear-gradient(90deg, #22D3EE, #6366F1)', boxShadow: '0 4px 20px rgba(34,211,238,0.3)' }}
                  >
                    {loading
                      ? <RefreshCw size={18} className="animate-spin" />
                      : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform duration-200" />
                    }
                    <span>Enter Evaluation Environment</span>
                  </button>
                </div>
              </div>

              {/* Production auth (collapsible) */}
              <details
                className="rounded-xl overflow-hidden"
                style={{ background: 'rgba(12,24,41,0.6)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)' }}
              >
                <summary className="px-5 py-4 cursor-pointer flex items-center justify-between text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors list-none select-none group">
                  <div className="flex items-center gap-2.5">
                    <Lock size={15} />
                    <span>Production Authentication</span>
                  </div>
                  <span className="text-slate-600 group-open:rotate-180 transition-transform duration-200">▼</span>
                </summary>

                <div className="px-5 pb-5 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-xs text-slate-500 mt-3 mb-4">
                    Authorized personnel only. Session established using secure HTTP-only cookies.
                  </p>
                  <form onSubmit={handleLoginSubmit} className="space-y-3">
                    <div>
                      <label htmlFor="login-username" className="label-text">Username</label>
                      <input
                        id="login-username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="Enter username"
                        className="input-field"
                      />
                    </div>
                    <div>
                      <label htmlFor="login-password" className="label-text">Password</label>
                      <input
                        id="login-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="input-field"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="btn-secondary w-full mt-1"
                    >
                      {loading ? 'Authenticating...' : 'Sign In'}
                    </button>
                  </form>
                </div>
              </details>
            </div>
          )}

          {/* STEP 2: MFA Challenge */}
          {step === 'mfa_challenge' && (
            <div
              className="p-8 rounded-2xl"
              style={{ background: 'rgba(12,24,41,0.8)', border: '1px solid rgba(34,211,238,0.15)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
            >
              <div className="text-center mb-7">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.25)' }}>
                  <Smartphone size={26} className="text-secondary" />
                </div>
                <h2 className="text-xl font-display font-bold text-white">Two-Factor Authentication</h2>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  Enter the 6-digit code from your authenticator app or an emergency backup code.
                </p>
              </div>

              <form onSubmit={handleMfaVerifySubmit} className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="label-text">{isBackupCode ? 'Emergency Backup Code' : 'TOTP Code'}</label>
                    <button type="button" onClick={() => setIsBackupCode(!isBackupCode)} className="text-xs text-primary hover:text-primary/80 font-medium transition-colors">
                      {isBackupCode ? 'Use 6-digit code' : 'Use backup code'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder={isBackupCode ? 'A1B2C3D4' : '000000'}
                    maxLength={isBackupCode ? 16 : 8}
                    required
                    autoFocus
                    className="input-field text-center text-xl font-mono tracking-[0.5em] text-primary"
                  />
                </div>
                <div className="flex gap-2.5">
                  <button type="button" onClick={() => { setStep('login'); setMfaToken(null); setMfaCode(''); }} className="btn-ghost flex-1 border border-border rounded-xl">
                    ← Back
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary flex-[2]">
                    {loading ? <RefreshCw size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                    {loading ? 'Verifying...' : 'Verify & Sign In'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 3: Authenticated */}
          {step === 'authenticated' && (
            <div className="space-y-4 animate-slide-up">
              <div
                className="p-6 rounded-2xl"
                style={{ background: 'rgba(12,24,41,0.8)', border: '1px solid rgba(16,185,129,0.2)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <UserCheck size={20} className="text-accent" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white">Active Session</h2>
                      <p className="text-xs text-slate-500">HTTP-only cookie session active</p>
                    </div>
                  </div>
                  <button onClick={handleLogout} disabled={loading} className="btn-danger text-xs">
                    <LogOut size={13} />
                    Sign Out
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  {[
                    { label: 'Username', val: sessionUser?.username || sessionUser?.userId || 'User', mono: true },
                    { label: 'Role', val: sessionUser?.role || 'Viewer', mono: true, highlight: true },
                    { label: 'Tenant', val: sessionUser?.tenantId || 'default', mono: true },
                  ].map(({ label, val, mono, highlight }) => (
                    <div key={label} className="px-3 py-2.5 rounded-xl text-xs" style={{ background: 'rgba(5,13,26,0.6)', border: '1px solid rgba(34,211,238,0.07)' }}>
                      <span className="text-slate-500 block mb-1">{label}</span>
                      <span className={`font-semibold text-sm ${mono ? 'font-mono' : ''} ${highlight ? 'text-primary' : 'text-slate-200'}`}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* MFA Enrollment */}
              <div
                className="p-6 rounded-2xl"
                style={{ background: 'rgba(12,24,41,0.8)', border: '1px solid rgba(129,140,248,0.15)', backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.2)' }}>
                      <Smartphone size={20} className="text-secondary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">MFA Setup</h3>
                      <p className="text-xs text-slate-500">RFC 6238 TOTP (Authenticator App)</p>
                    </div>
                  </div>
                  {!mfaSetupData && (
                    <button onClick={handleStartMfaEnrollment} disabled={loading} className="btn-secondary text-xs px-3 py-1.5" style={{ borderColor: 'rgba(129,140,248,0.3)', color: '#818CF8' }}>
                      Configure MFA
                    </button>
                  )}
                </div>

                {mfaSetupData && (
                  <div className="space-y-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="p-3.5 rounded-xl text-xs" style={{ background: 'rgba(129,140,248,0.06)', border: '1px solid rgba(129,140,248,0.2)' }}>
                      <p className="font-semibold text-secondary mb-1">Step 1: Add to your authenticator app</p>
                      <p className="text-slate-400">{mfaSetupData.instructions}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-3 text-xs">
                        <div>
                          <span className="label-text">TOTP Secret Key</span>
                          <div className="flex items-center gap-2 mt-1.5">
                            <code className="flex-1 p-2.5 rounded-lg font-mono text-primary text-sm break-all" style={{ background: 'rgba(5,13,26,0.8)', border: '1px solid rgba(34,211,238,0.12)' }}>
                              {mfaSetupData.secret}
                            </code>
                            <button onClick={() => copyToClipboard(mfaSetupData.secret)} className="btn-ghost p-2.5 border border-border rounded-lg" title="Copy">
                              {copiedSecret ? <CheckCircle size={15} className="text-accent" /> : <Copy size={15} />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <span className="label-text">Authenticator URI</span>
                          <div className="p-2.5 rounded-lg font-mono text-2xs text-slate-500 break-all mt-1.5" style={{ background: 'rgba(5,13,26,0.8)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            {mfaSetupData.otpAuthUri}
                          </div>
                        </div>
                      </div>

                      <div>
                        <span className="label-text">Recovery Codes — Save Securely</span>
                        <div className="grid grid-cols-2 gap-1.5 p-3 rounded-xl mt-1.5" style={{ background: 'rgba(5,13,26,0.8)', border: '1px solid rgba(16,185,129,0.12)' }}>
                          {mfaSetupData.backupCodes.map((code, idx) => (
                            <span key={idx} className="px-2 py-1 rounded-md font-mono text-xs text-accent" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.1)' }}>
                              {code}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <form onSubmit={handleConfirmMfaEnrollment} className="flex gap-2.5 items-end pt-2">
                      <div className="flex-1">
                        <label className="label-text">Step 2: Enter code from authenticator to confirm</label>
                        <input
                          type="text"
                          value={enrollmentCode}
                          onChange={(e) => setEnrollmentCode(e.target.value)}
                          placeholder="000000"
                          maxLength={8}
                          className="input-field font-mono text-center tracking-widest text-primary mt-1.5"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setMfaSetupData(null)} className="btn-ghost border border-border rounded-xl px-4 py-2.5 text-xs">Cancel</button>
                        <button type="submit" disabled={loading} className="btn-primary text-xs px-5" style={{ background: 'linear-gradient(90deg, #10B981, #059669)' }}>
                          {loading ? 'Confirming...' : 'Enable MFA'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Login;
