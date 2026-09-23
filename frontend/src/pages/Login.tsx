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
  memoryTokenStore,
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
      if (res.accessToken) {
        memoryTokenStore.setToken('access_token', res.accessToken);
      }
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
        if (res.accessToken) {
          memoryTokenStore.setToken('access_token', res.accessToken);
        }
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

      if (res.accessToken) {
        memoryTokenStore.setToken('access_token', res.accessToken);
      }
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
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-4">
      {/* ECDAT Logo & Branding */}
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-slate-950 shadow-xl shadow-cyan-500/20">
          <Shield size={36} className="stroke-[2.5]" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2">
            ECDAT
          </h1>
          <p className="text-sm text-slate-400 font-medium tracking-wide">
            Enterprise Cryptographic Discovery and Assessment Tool
          </p>
        </div>
      </div>

      {/* Alert Notices */}
      {errorMsg && (
        <div className="max-w-md w-full mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-rose-300 text-sm shadow-lg">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
          <div className="flex-1">{errorMsg}</div>
        </div>
      )}
      {successMsg && (
        <div className="max-w-md w-full mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 text-emerald-300 text-sm shadow-lg">
          <CheckCircle size={18} className="shrink-0 mt-0.5 text-emerald-400" />
          <div className="flex-1">{successMsg}</div>
        </div>
      )}

      {/* STEP 1: Login Form */}
      {step === 'login' && (
        <div className="w-full max-w-md space-y-6">
          {/* Evaluation Environment Primary Action */}
          <div className="glass-card p-8 rounded-3xl border border-slate-700 bg-slate-900/80 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3">
              <span className="text-xs px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 font-bold border border-cyan-500/20 uppercase tracking-widest">
                Evaluation
              </span>
            </div>

            <h2 className="text-xl font-bold text-white mb-2">Enter Evaluation Environment</h2>
            <p className="text-sm text-slate-400 mb-6 leading-relaxed">
              Explore cryptographic discovery, CBOM, PQC assessment, migration planning and remediation using synthetic evaluation data. No production systems connected.
            </p>

            <button
              type="button"
              onClick={handleEnterEvaluation}
              disabled={loading}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-extrabold text-sm shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 transition-all disabled:opacity-50 group cursor-pointer"
            >
              {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
              <span>Enter Evaluation Environment</span>
            </button>
          </div>

          {/* Technical / Production Login Details Collapsed */}
          <details className="group glass-card rounded-2xl border border-slate-800 bg-slate-900/40">
            <summary className="px-6 py-4 cursor-pointer flex items-center justify-between text-sm font-semibold text-slate-400 hover:text-slate-200 transition-colors list-none select-none">
              <div className="flex items-center gap-2">
                <Lock size={16} />
                <span>Production Authentication</span>
              </div>
              <div className="text-slate-600 group-open:rotate-180 transition-transform">▼</div>
            </summary>
            
            <div className="p-6 pt-0 border-t border-slate-800/50 mt-2">
              <p className="text-xs text-slate-500 mb-4">
                Authorized personnel only. Authenticate via local credentials. Session established using secure HTTP-only cookies.
              </p>
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter username"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-slate-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition-all disabled:opacity-50"
                >
                  {loading ? 'Authenticating...' : 'Sign In'}
                </button>
              </form>
            </div>
          </details>
        </div>
      )}

      {/* STEP 2: MFA Challenge Verification */}
      {step === 'mfa_challenge' && (
        <div className="glass-card max-w-lg mx-auto p-8 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-2xl">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 flex items-center justify-center mx-auto mb-3">
              <Smartphone size={24} />
            </div>
            <h2 className="text-xl font-bold text-white">Two-Factor Authentication</h2>
            <p className="text-xs text-slate-400 mt-1">
              Enter the 6-digit verification code from your authenticator app or an emergency backup code.
            </p>
          </div>

          <form onSubmit={handleMfaVerifySubmit} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-300">
                  {isBackupCode ? 'Emergency Backup Code' : 'TOTP Verification Code'}
                </label>
                <button
                  type="button"
                  onClick={() => setIsBackupCode(!isBackupCode)}
                  className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
                >
                  {isBackupCode ? 'Use 6-digit TOTP instead' : 'Use 8-character backup code'}
                </button>
              </div>

              <input
                type="text"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder={isBackupCode ? 'e.g. A1B2C3D4' : '000000'}
                maxLength={isBackupCode ? 16 : 8}
                required
                autoFocus
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('login');
                  setMfaToken(null);
                  setMfaCode('');
                }}
                className="w-1/3 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-2/3 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCw size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                <span>{loading ? 'Verifying...' : 'Verify & Sign In'}</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 3: Authenticated Session & MFA Enrollment Surface */}
      {step === 'authenticated' && (
        <div className="space-y-6">
          {/* Active Session Overview */}
          <div className="glass-card p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <UserCheck size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Active Authenticated Session</h2>
                  <p className="text-xs text-slate-400">
                    HTTP-only cookie session active: <code className="text-emerald-400">ecdat_access_token</code>
                  </p>
                </div>
              </div>

              <button
                onClick={handleLogout}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-800 text-xs">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Username / Subject</span>
                <span className="text-white font-mono font-bold text-sm">
                  {sessionUser?.username || sessionUser?.userId || 'Authenticated User'}
                </span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Assigned Role</span>
                <span className="text-cyan-300 font-mono font-bold text-sm">
                  {sessionUser?.role || 'Viewer'}
                </span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                <span className="text-slate-500 font-medium block mb-1">Tenant Context</span>
                <span className="text-slate-300 font-mono text-sm">
                  {sessionUser?.tenantId || 'default-tenant'}
                </span>
              </div>
            </div>
          </div>

          {/* MFA Enrollment & Management Surface */}
          <div className="glass-card p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20">
                  <Smartphone size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Multi-Factor Authentication (MFA) Setup</h3>
                  <p className="text-xs text-slate-400">
                    Configure RFC 6238 TOTP (Google Authenticator, 1Password, Authy) for this account.
                  </p>
                </div>
              </div>

              {!mfaSetupData && (
                <button
                  onClick={handleStartMfaEnrollment}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold shadow-md shadow-violet-600/20 transition-all"
                >
                  Configure MFA
                </button>
              )}
            </div>

            {/* MFA Setup Flow */}
            {mfaSetupData && (
              <div className="mt-6 pt-6 border-t border-slate-800 space-y-6">
                <div className="p-4 rounded-xl bg-violet-950/30 border border-violet-500/30 text-xs text-slate-300">
                  <p className="font-semibold text-violet-300 mb-1">Step 1: Save your Secret Key or Scan URI</p>
                  <p>{mfaSetupData.instructions}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Secret details */}
                  <div className="space-y-4 text-xs">
                    <div>
                      <span className="text-slate-400 block mb-1 font-semibold">TOTP Secret Key</span>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 p-2.5 rounded-lg bg-slate-950 border border-slate-800 font-mono text-cyan-300 text-sm break-all">
                          {mfaSetupData.secret}
                        </code>
                        <button
                          onClick={() => copyToClipboard(mfaSetupData.secret)}
                          className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          title="Copy secret key"
                        >
                          {copiedSecret ? <CheckCircle size={16} className="text-emerald-400" /> : <Copy size={16} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span className="text-slate-400 block mb-1 font-semibold">Authenticator URI (`otpauth://`)</span>
                      <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 font-mono text-2xs text-slate-400 break-all">
                        {mfaSetupData.otpAuthUri}
                      </div>
                    </div>
                  </div>

                  {/* Backup codes */}
                  <div>
                    <span className="text-slate-400 block mb-1 font-semibold text-xs">
                      Single-Use Recovery Codes (Save these securely)
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400">
                      {mfaSetupData.backupCodes.map((code, idx) => (
                        <span key={idx} className="px-1 py-0.5 bg-slate-900 rounded border border-slate-800">
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Step 2: Confirm Code */}
                <form onSubmit={handleConfirmMfaEnrollment} className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-end gap-3">
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Step 2: Enter 6-digit Code from Authenticator to Confirm
                    </label>
                    <input
                      type="text"
                      value={enrollmentCode}
                      onChange={(e) => setEnrollmentCode(e.target.value)}
                      placeholder="000000"
                      maxLength={8}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => setMfaSetupData(null)}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                    >
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
  );
};

export default Login;
