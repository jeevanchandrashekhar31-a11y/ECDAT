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
 <div className="p-3.5 rounded-2xl bg-brand text-text-muted shadow-xl ">
 <Shield size={36} className="stroke-[2.5]" />
 </div>
 <div>
 <h1 className="text-3xl font-extrabold text-text-brand tracking-tight flex items-center gap-2">
 ECDAT
 </h1>
 <p className="text-sm text-text-secondary font-medium tracking-wide">
 Enterprise Cryptographic Discovery and Assessment Tool
 </p>
 </div>
 </div>

 {/* Alert Notices */}
 {errorMsg && (
 <div className="max-w-md w-full mb-6 p-4 rounded-xl bg-critical/10 border border-critical flex items-start gap-3 text-critical text-sm ">
 <AlertCircle size={18} className="shrink-0 mt-0.5 text-critical" />
 <div className="flex-1">{errorMsg}</div>
 </div>
 )}
 {successMsg && (
 <div className="max-w-md w-full mb-6 p-4 rounded-xl bg-success/10 border border-success flex items-start gap-3 text-success text-sm ">
 <CheckCircle size={18} className="shrink-0 mt-0.5 text-success" />
 <div className="flex-1">{successMsg}</div>
 </div>
 )}

 {/* STEP 1: Login Form */}
 {step === 'login' && (
 <div className="w-full max-w-md space-y-6">
 {/* Evaluation Environment Primary Action */}
 <div className="glass-card p-8 rounded-3xl border border-border-soft bg-bg-1/80 shadow-md relative overflow-hidden">
 <div className="absolute top-0 right-0 p-3">
 <span className="text-xs px-2.5 py-1 rounded-full bg-pqc/10 text-crypto font-bold border border-pqc/20 uppercase tracking-widest">
 Evaluation
 </span>
 </div>

 <h2 className="text-xl font-bold text-text-brand mb-2">Enter Evaluation Environment</h2>
 <p className="text-sm text-text-secondary mb-6 leading-relaxed">
 Explore cryptographic discovery, CBOM, PQC assessment, migration planning and remediation using synthetic evaluation data. No production systems connected.
 </p>

 <button
 type="button"
 onClick={handleEnterEvaluation}
 disabled={loading}
 className="w-full py-3.5 px-4 rounded-xl bg-brand hover:bg-brand hover: text-text-muted font-extrabold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 group cursor-pointer"
 >
 {loading ? <RefreshCw size={18} className="animate-spin" /> : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
 <span>Enter Evaluation Environment</span>
 </button>
 </div>

 {/* Technical / Production Login Details Collapsed */}
 <details className="group glass-card rounded-2xl border border-border bg-bg-1/40">
 <summary className="px-6 py-4 cursor-pointer flex items-center justify-between text-sm font-semibold text-text-secondary hover:text-text-brand transition-colors list-none select-none">
 <div className="flex items-center gap-2">
 <Lock size={16} />
 <span>Production Authentication</span>
 </div>
 <div className="text-text-muted group-open:rotate-180 transition-transform">▼</div>
 </summary>
 
 <div className="p-6 pt-0 border-t border-border mt-2">
 <p className="text-xs text-text-muted mb-4">
 Authorized personnel only. Authenticate via local credentials. Session established using secure HTTP-only cookies.
 </p>
 <form onSubmit={handleLoginSubmit} className="space-y-4">
 <div>
 <label className="block text-xs font-semibold text-text-secondary mb-1">Username</label>
 <input
 type="text"
 value={username}
 onChange={(e) => setUsername(e.target.value)}
 placeholder="Enter username"
 className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm text-text-brand placeholder-slate-600 focus:outline-none focus:border-border-soft"
 />
 </div>
 <div>
 <label className="block text-xs font-semibold text-text-secondary mb-1">Password</label>
 <input
 type="password"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 placeholder="Enter password"
 className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm text-text-brand placeholder-slate-600 focus:outline-none focus:border-border-soft"
 />
 </div>
 <button
 type="submit"
 disabled={loading}
 className="w-full py-2.5 px-4 rounded-xl bg-surface hover:bg-surface-2 text-text-secondary font-bold text-sm transition-all disabled:opacity-50"
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
 <div className="glass-card max-w-lg mx-auto p-8 rounded-2xl border border-border bg-bg-1/60 shadow-md">
 <div className="text-center mb-6">
 <div className="w-12 h-12 rounded-xl bg-specialized text-specialized border border-specialized flex items-center justify-center mx-auto mb-3">
 <Smartphone size={24} />
 </div>
 <h2 className="text-xl font-bold text-text-brand">Two-Factor Authentication</h2>
 <p className="text-xs text-text-secondary mt-1">
 Enter the 6-digit verification code from your authenticator app or an emergency backup code.
 </p>
 </div>

 <form onSubmit={handleMfaVerifySubmit} className="space-y-4">
 <div>
 <div className="flex items-center justify-between mb-1">
 <label className="text-xs font-semibold text-text-secondary">
 {isBackupCode ? 'Emergency Backup Code' : 'TOTP Verification Code'}
 </label>
 <button
 type="button"
 onClick={() => setIsBackupCode(!isBackupCode)}
 className="text-xs text-crypto hover:text-crypto font-medium"
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
 className="w-full bg-background border border-border rounded-xl px-4 py-3 text-center text-lg font-mono tracking-widest text-crypto placeholder-slate-600 focus:outline-none focus:border-pqc transition-colors"
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
 className="w-1/3 py-2.5 px-4 rounded-xl bg-surface hover:bg-surface-2 text-text-secondary text-xs font-semibold"
 >
 Back
 </button>
 <button
 type="submit"
 disabled={loading}
 className="w-2/3 py-2.5 px-4 rounded-xl bg-brand hover:bg-brand hover: text-text-muted font-bold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
 <div className="glass-card p-6 rounded-2xl border border-border bg-bg-1/60 shadow-xl">
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-3">
 <div className="p-2 rounded-xl bg-success/10 text-success border border-success">
 <UserCheck size={20} />
 </div>
 <div>
 <h2 className="text-base font-bold text-text-brand">Active Authenticated Session</h2>
 <p className="text-xs text-text-secondary">
 HTTP-only cookie session active: <code className="text-success">ecdat_access_token</code>
 </p>
 </div>
 </div>

 <button
 onClick={handleLogout}
 disabled={loading}
 className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-critical/10 hover:bg-critical/20 text-critical border border-critical text-xs font-semibold transition-colors"
 >
 <LogOut size={14} />
 <span>Sign Out</span>
 </button>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border text-xs">
 <div className="bg-background/60 p-3 rounded-xl border border-border">
 <span className="text-text-muted font-medium block mb-1">Username / Subject</span>
 <span className="text-text-brand font-mono font-bold text-sm">
 {sessionUser?.username || sessionUser?.userId || 'Authenticated User'}
 </span>
 </div>
 <div className="bg-background/60 p-3 rounded-xl border border-border">
 <span className="text-text-muted font-medium block mb-1">Assigned Role</span>
 <span className="text-crypto font-mono font-bold text-sm">
 {sessionUser?.role || 'Viewer'}
 </span>
 </div>
 <div className="bg-background/60 p-3 rounded-xl border border-border">
 <span className="text-text-muted font-medium block mb-1">Tenant Context</span>
 <span className="text-text-secondary font-mono text-sm">
 {sessionUser?.tenantId || 'default-tenant'}
 </span>
 </div>
 </div>
 </div>

 {/* MFA Enrollment & Management Surface */}
 <div className="glass-card p-6 rounded-2xl border border-border bg-bg-1/60 shadow-xl">
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-3">
 <div className="p-2 rounded-xl bg-specialized text-specialized border border-specialized">
 <Smartphone size={20} />
 </div>
 <div>
 <h3 className="text-base font-bold text-text-brand">Multi-Factor Authentication (MFA) Setup</h3>
 <p className="text-xs text-text-secondary">
 Configure RFC 6238 TOTP (Google Authenticator, 1Password, Authy) for this account.
 </p>
 </div>
 </div>

 {!mfaSetupData && (
 <button
 onClick={handleStartMfaEnrollment}
 disabled={loading}
 className="px-4 py-2 rounded-xl bg-specialized hover:bg-specialized text-text-brand text-xs font-bold shadow-md shadow-violet-600/20 transition-all"
 >
 Configure MFA
 </button>
 )}
 </div>

 {/* MFA Setup Flow */}
 {mfaSetupData && (
 <div className="mt-6 pt-6 border-t border-border space-y-6">
 <div className="p-4 rounded-xl bg-surface-2 border border-specialized text-xs text-text-secondary">
 <p className="font-semibold text-specialized mb-1">Step 1: Save your Secret Key or Scan URI</p>
 <p>{mfaSetupData.instructions}</p>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
 {/* Secret details */}
 <div className="space-y-4 text-xs">
 <div>
 <span className="text-text-secondary block mb-1 font-semibold">TOTP Secret Key</span>
 <div className="flex items-center gap-2">
 <code className="flex-1 p-2.5 rounded-lg bg-background border border-border font-mono text-crypto text-sm break-all">
 {mfaSetupData.secret}
 </code>
 <button
 onClick={() => copyToClipboard(mfaSetupData.secret)}
 className="p-2.5 rounded-lg bg-surface hover:bg-surface-2 text-text-secondary transition-colors"
 title="Copy secret key"
 >
 {copiedSecret ? <CheckCircle size={16} className="text-success" /> : <Copy size={16} />}
 </button>
 </div>
 </div>

 <div>
 <span className="text-text-secondary block mb-1 font-semibold">Authenticator URI (`otpauth://`)</span>
 <div className="p-2 rounded-lg bg-background border border-border font-mono text-2xs text-text-secondary break-all">
 {mfaSetupData.otpAuthUri}
 </div>
 </div>
 </div>

 {/* Backup codes */}
 <div>
 <span className="text-text-secondary block mb-1 font-semibold text-xs">
 Single-Use Recovery Codes (Save these securely)
 </span>
 <div className="grid grid-cols-2 gap-1.5 p-3 rounded-xl bg-background border border-border font-mono text-xs text-success">
 {mfaSetupData.backupCodes.map((code, idx) => (
 <span key={idx} className="px-1 py-0.5 bg-bg-1 rounded border border-border">
 {code}
 </span>
 ))}
 </div>
 </div>
 </div>

 {/* Step 2: Confirm Code */}
 <form onSubmit={handleConfirmMfaEnrollment} className="pt-4 border-t border-border flex flex-col sm:flex-row items-end gap-3">
 <div className="flex-1 w-full">
 <label className="block text-xs font-semibold text-text-secondary mb-1">
 Step 2: Enter 6-digit Code from Authenticator to Confirm
 </label>
 <input
 type="text"
 value={enrollmentCode}
 onChange={(e) => setEnrollmentCode(e.target.value)}
 placeholder="000000"
 maxLength={8}
 className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-mono text-crypto focus:outline-none focus:border-pqc"
 />
 </div>
 <div className="flex gap-2 w-full sm:w-auto">
 <button
 type="button"
 onClick={() => setMfaSetupData(null)}
 className="px-4 py-2.5 rounded-xl bg-surface hover:bg-surface-2 text-text-secondary text-xs font-semibold"
 >
 Cancel
 </button>
 <button
 type="submit"
 disabled={loading}
 className="px-6 py-2.5 rounded-xl bg-success hover:bg-success text-text-muted text-xs font-bold transition-all disabled:opacity-50"
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
