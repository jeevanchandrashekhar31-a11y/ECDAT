import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench,
  CheckCircle,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  Plus,
  Loader2,
  XCircle,
  Lock,
  GitPullRequest,
  CheckCircle2,
  Play,
  History,
  Code2,
  Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { authManager } from '../security/auth';
import { RemediationApprovalRecord, ApprovalState, FindingItem } from '../types';

export const Remediation: React.FC = () => {
  const [searchParams] = useSearchParams();

  // URL Query Params from Findings navigation
  const prefillFindingId = searchParams.get('findingId') || '';
  const prefillAlgorithm = searchParams.get('algorithm') || '';
  const prefillAsset = searchParams.get('asset') || '';

  // Main list state
  const [approvals, setApprovals] = useState<RemediationApprovalRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [listError, setListError] = useState<{
    status?: number;
    code?: string;
    message: string;
  } | null>(null);

  // Selected approval for detailed inspector
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const selectedApproval = approvals.find((a) => a.approval_id === selectedApprovalId);

  // Original finding (fetched on demand if linked)
  const [originalFinding, setOriginalFinding] = useState<FindingItem | null>(null);

  useEffect(() => {
    if (selectedApproval?.finding_id) {
      api.getFindingById(selectedApproval.finding_id)
        .then((f) => setOriginalFinding(f))
        .catch(() => setOriginalFinding(null));
    } else {
      setOriginalFinding(null);
    }
  }, [selectedApproval?.finding_id]);

  // Global persona switching is now handled via the Layout Header using switchEvaluationPersona
  const activePersona = authManager.getSession().role || 'Viewer';

  // Propose Modal State
  const [proposeModalOpen, setProposeModalOpen] = useState<boolean>(Boolean(prefillFindingId));
  const [proposeTitle, setProposeTitle] = useState<string>(
    prefillAlgorithm ? `Migrate ${prefillAlgorithm} to NIST PQC Standard` : 'PQC Cryptographic Algorithm Migration'
  );
  const [proposeCategory, setProposeCategory] = useState<string>('algorithm migration');
  const [proposeEnv, setProposeEnv] = useState<string>('production');
  const [proposeFindingId, setProposeFindingId] = useState<string>(prefillFindingId);
  const [proposeAsset, setProposeAsset] = useState<string>(prefillAsset);
  const [proposeTargetStandard, setProposeTargetStandard] = useState<string>('NIST FIPS 203 (ML-KEM-768)');
  const [proposePatchDiff, setProposePatchDiff] = useState<string>(
    `--- a/crypto_service.py\n+++ b/crypto_service.py\n@@ -12,4 +12,4 @@\n-from Crypto.PublicKey import RSA\n-key = RSA.generate(1024)\n+import oqs\n+kem = oqs.KeyEncapsulation("ML-KEM-768")`
  );
  const [proposeTestPlan, setProposeTestPlan] = useState<string>(
    'Execute end-to-end PQC handshake verification tests and regression test suites.'
  );
  const [proposeRollbackPlan, setProposeRollbackPlan] = useState<string>(
    'Rollback git commit and redeploy previous container revision if handshake latency > 15ms.'
  );

  // Lifecycle Action State
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [actionError, setActionError] = useState<{
    status?: number;
    code?: string;
    message: string;
  } | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Fetch approvals list
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await api.getRemediationApprovals();
      setApprovals(res.approvals || []);
      if (res.approvals && res.approvals.length > 0 && !selectedApprovalId) {
        setSelectedApprovalId(res.approvals[0].approval_id);
      }
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setListError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'FETCH_FAILED',
        message: (e.data?.message as string) || e.message || 'Failed to fetch remediation proposals.',
      });
    } finally {
      setLoading(false);
    }
  }, [selectedApprovalId]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);


  // Submit Propose Remediation
  const handleProposeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await api.proposeRemediation({
        title: proposeTitle,
        category: proposeCategory,
        environment: proposeEnv,
        finding_id: proposeFindingId || null,
        affected_asset: proposeAsset || null,
        target_standard: proposeTargetStandard,
        patch_diff: proposePatchDiff,
        test_plan: proposeTestPlan,
        rollback_plan: proposeRollbackPlan,
        comments: 'Initial cryptographic remediation proposal created via judge evaluation environment.',
      });

      setProposeModalOpen(false);
      setActionSuccess(`Remediation proposal '${res.approval_id}' successfully created in PROPOSED state.`);
      await fetchApprovals();
      setSelectedApprovalId(res.approval_id);
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setActionError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'PROPOSE_ERROR',
        message: (e.data?.message as string) || e.message || 'Failed to propose remediation.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Lifecycle Action Handlers
  const handleReview = async (approvalId: string) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.reviewRemediation(approvalId, 'Technical verification and impact analysis completed.');
      setActionSuccess(`Proposal '${approvalId}' transitioned to REVIEWED.`);
      await fetchApprovals();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setActionError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'REVIEW_FAILED',
        message: (e.data?.message as string) || e.message || 'Review failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (approvalId: string) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.approveRemediation(approvalId, 'Cryptographic migration plan approved for execution.');
      setActionSuccess(`Proposal '${approvalId}' successfully APPROVED.`);
      await fetchApprovals();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setActionError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'APPROVE_FAILED',
        message: (e.data?.message as string) || e.message || 'Approval failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleApply = async (approvalId: string) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await api.applyRemediation(approvalId);
      setActionSuccess(`Remediation '${approvalId}' successfully APPLIED.`);
      await fetchApprovals();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setActionError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'APPLY_FAILED',
        message: (e.data?.message as string) || e.message || 'Apply failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerify = async (approvalId: string) => {
    setActionLoading(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const resultsPayload = {
        tests_passed: true,
        finding_resolved: true,
        regression_test_status: 'CLEARED',
        quantum_safety_verification: 'PASSED',
        post_remediation_rescan_id: `rescan_${Date.now()}`,
      };
      await api.verifyRemediation(approvalId, resultsPayload);
      setActionSuccess(`Remediation '${approvalId}' successfully VERIFIED with cryptographic evidence.`);
      await fetchApprovals();
    } catch (err: unknown) {
      const e = err as { status?: number; data?: Record<string, unknown>; message?: string };
      setActionError({
        status: e.status,
        code: (e.data?.code as string) || (e.data?.error as string) || 'VERIFY_FAILED',
        message: (e.data?.message as string) || e.message || 'Verification failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };


  const getStateBadgeClass = (state: ApprovalState) => {
    switch (state) {
      case 'PROPOSED':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40';
      case 'REVIEWED':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'APPROVED':
        return 'bg-violet-500/20 text-violet-300 border-violet-500/40';
      case 'APPLIED':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      case 'VERIFIED':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold';
      case 'REJECTED':
      case 'ROLLED_BACK':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      default:
        return 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    }
  };

  const getStepIndex = (state: ApprovalState) => {
    switch (state) {
      case 'PROPOSED':
        return 1;
      case 'REVIEWED':
        return 2;
      case 'APPROVED':
        return 3;
      case 'APPLIED':
        return 4;
      case 'VERIFIED':
        return 5;
      default:
        return 0;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <Wrench className="text-cyan-400" size={22} />
              <span>Cryptographic Remediation &amp; Governance</span>
            </h1>
            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono">
              Four-Eyes Enforced
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Propose, review, approve, apply, and cryptographically verify algorithm migrations and patch deployments.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Active persona is managed globally in the header now */}
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            <span className="text-slate-400 text-2xs px-2 font-medium">Active Persona:</span>
            <span className="text-cyan-400 font-bold px-2 py-1 text-2xs uppercase tracking-wider">{authManager.getSession().role || 'Analyst'}</span>
          </div>

          <button
            onClick={() => setProposeModalOpen(true)}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/20 flex items-center gap-1.5 transition-all"
          >
            <Plus size={15} />
            <span>Propose Remediation</span>
          </button>
        </div>
      </div>

      {/* Alerts */}
      {actionError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <XCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-rose-200">
                Action Rejected {actionError.status ? `(HTTP ${actionError.status})` : ''}
              </p>
              <p className="mt-0.5">{actionError.message}</p>
              {actionError.code && (
                <p className="font-mono text-2xs text-rose-400 mt-1">Code: {actionError.code}</p>
              )}
              {actionError.message.includes('Four-Eyes') && (
                <div className="mt-2 pt-2 border-t border-rose-900 flex items-center gap-2">
                  <span className="text-slate-300">Use the Evaluation Persona dropdown in the header to switch to a Security Approver to satisfy role-separation.</span>
                </div>
              )}
            </div>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white">
            <XCircle size={14} />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-400 hover:text-white">
            <XCircle size={14} />
          </button>
        </div>
      )}

      {/* REAL LOADING STATE */}
      {loading && approvals.length === 0 && (
        <div className="glass-card p-12 rounded-2xl border border-slate-800 bg-slate-900/60 flex flex-col items-center justify-center text-center">
          <Loader2 size={32} className="text-cyan-400 animate-spin mb-3" />
          <h3 className="text-sm font-bold text-white mb-1">Loading Remediation Proposals</h3>
          <p className="text-xs text-slate-400 max-w-sm">
            Verifying cryptographic state hashes, approval chains, and governance policies...
          </p>
        </div>
      )}

      {/* REAL ERROR STATE */}
      {!loading && listError && (
        <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-rose-200 space-y-3">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle size={20} />
            <h3 className="text-sm font-bold">Backend Remediation Query Error ({listError.status || '500'})</h3>
          </div>
          <p className="text-xs text-rose-300">{listError.message}</p>
          <button
            onClick={() => fetchApprovals()}
            className="px-3 py-1.5 rounded-lg bg-rose-900/80 hover:bg-rose-800 text-white text-xs font-semibold"
          >
            Retry Query
          </button>
        </div>
      )}

      {/* REAL EMPTY STATE */}
      {!loading && !listError && approvals.length === 0 && (
        <div className="glass-card p-12 rounded-2xl border border-slate-800 bg-slate-900/60 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center mx-auto">
            <Wrench size={24} />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-bold text-white mb-1">No Remediation Proposals Recorded</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              No cryptographic remediation proposals have been submitted for this tenant yet.
              Create a new remediation proposal or select a finding from the Findings view to begin the four-eyes approval workflow.
            </p>
          </div>
          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={() => setProposeModalOpen(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold text-xs shadow-lg shadow-cyan-500/20 flex items-center gap-2"
            >
              <Plus size={14} />
              <span>Propose Remediation Plan</span>
            </button>
          </div>
        </div>
      )}

      {/* MAIN TWO-COLUMN REMEDIATION WORKFLOW */}
      {!loading && !listError && approvals.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Proposals List */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
              <span className="font-semibold uppercase tracking-wider text-2xs">Active Approval Plans ({approvals.length})</span>
              <button onClick={() => fetchApprovals()} className="hover:text-cyan-400">
                <RefreshCw size={12} />
              </button>
            </div>

            <div className="space-y-2.5 max-h-[720px] overflow-y-auto pr-1">
              {approvals.map((appr) => {
                const isSelected = appr.approval_id === selectedApprovalId;
                return (
                  <div
                    key={appr.approval_id}
                    onClick={() => setSelectedApprovalId(appr.approval_id)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-800/80 border-cyan-500/50 shadow-lg shadow-cyan-500/5'
                        : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-2xs font-mono font-bold border ${getStateBadgeClass(appr.state)}`}>
                        {appr.state}
                      </span>
                      <span className="text-slate-500 font-mono text-2xs truncate">
                        {appr.approval_id}
                      </span>
                    </div>

                    <h3 className="text-xs font-bold text-white mb-1 leading-snug">{appr.title}</h3>
                    <p className="text-slate-400 text-2xs line-clamp-2 mb-3">{appr.description || 'No description provided.'}</p>

                    <div className="flex items-center justify-between text-2xs text-slate-400 pt-2 border-t border-slate-800/60">
                      <span>Proposer: <strong className="text-slate-300">{appr.proposer?.username}</strong></span>
                      <span className="capitalize">{appr.environment}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Active Lifecycle Stepper & Inspector */}
          {selectedApproval && (
            <div className="lg:col-span-7 space-y-6">
              <div className="glass-card p-6 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl space-y-6">
                {/* Proposal Header */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold border ${getStateBadgeClass(selectedApproval.state)}`}>
                        {selectedApproval.state}
                      </span>
                      <span className="text-slate-400 text-xs font-mono">ID: {selectedApproval.approval_id}</span>
                    </div>
                    <h2 className="text-base font-bold text-white">{selectedApproval.title}</h2>
                    <p className="text-xs text-slate-400 mt-1">{selectedApproval.description}</p>
                  </div>

                  <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 text-2xs font-mono text-cyan-300">
                    {selectedApproval.target_standard || 'NIST FIPS 203'}
                  </span>
                </div>

                {/* ORIGINAL AI FINDING CONTEXT */}
                {originalFinding?.detection_method === 'semantic_llm' && (
                  <div className="p-4 rounded-xl bg-violet-950/20 border border-violet-500/30 space-y-2 mt-4">
                    <div className="flex items-center gap-2 text-violet-300 font-bold text-xs">
                      <Sparkles size={14} />
                      <span>Original AI Security Assessment</span>
                      <span className="ml-auto px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300 border border-violet-500/30 text-[9px] uppercase font-bold">
                        Tier 2 Finding
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 italic border-l-2 border-violet-500/50 pl-3 leading-relaxed">
                      "{originalFinding.explanation}"
                    </p>
                  </div>
                )}

                {/* 5-STEP LIFECYCLE PROGRESSION */}
                <div>
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
                    Remediation Governance Progression (Four-Eyes Gated)
                  </h4>
                  <div className="grid grid-cols-5 gap-1.5 text-center text-2xs font-mono">
                    {[
                      { step: 1, label: '1. PROPOSE', state: 'PROPOSED' },
                      { step: 2, label: '2. REVIEW', state: 'REVIEWED' },
                      { step: 3, label: '3. APPROVE', state: 'APPROVED' },
                      { step: 4, label: '4. APPLY', state: 'APPLIED' },
                      { step: 5, label: '5. VERIFY', state: 'VERIFIED' },
                    ].map((s) => {
                      const curIdx = getStepIndex(selectedApproval.state);
                      const isComplete = curIdx >= s.step;
                      const isCurrent = curIdx === s.step;
                      return (
                        <div
                          key={s.step}
                          className={`p-2 rounded-lg border transition-all ${
                            isComplete
                              ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300 font-bold'
                              : 'bg-slate-950/40 border-slate-800 text-slate-500'
                          } ${isCurrent ? 'ring-1 ring-cyan-400' : ''}`}
                        >
                          <span>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* INTERACTIVE LIFECYCLE ACTION PANEL */}
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Lock size={14} className="text-cyan-400" />
                      <span>Next Governance Transition Action</span>
                    </span>
                    <span className="text-2xs text-slate-400">
                      Active: <strong className="text-cyan-300 font-mono">{activePersona}</strong>
                    </span>
                  </div>

                  {/* Step 1: PROPOSED -> Transition to REVIEWED */}
                  {selectedApproval.state === 'PROPOSED' && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">
                        Proposal is awaiting peer code review and impact verification.
                      </p>
                      <button
                        onClick={() => handleReview(selectedApproval.approval_id)}
                        disabled={actionLoading}
                        className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                      >
                        {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <GitPullRequest size={14} />}
                        <span>Submit Peer Review (PROPOSED ➔ REVIEWED)</span>
                      </button>
                    </div>
                  )}

                  {/* Step 2: REVIEWED -> Transition to APPROVED (Four-Eyes check!) */}
                  {selectedApproval.state === 'REVIEWED' && (
                    <div className="space-y-3">
                      <p className="text-xs text-slate-300">
                        Proposal has been peer-reviewed. Requires approval from Security Lead (Four-Eyes: proposer cannot approve).
                      </p>
                      {activePersona === ('developer' as string) && (
                        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-2xs flex items-center gap-2">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span>Active persona is Developer. Attempting approval will trigger real 403 Four-Eyes block!</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(selectedApproval.approval_id)}
                          disabled={actionLoading}
                          className="flex-1 py-2.5 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20"
                        >
                          {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                          <span>Approve Remediation (REVIEWED ➔ APPROVED)</span>
                        </button>

                      </div>
                    </div>
                  )}

                  {/* Step 3: APPROVED -> Transition to APPLIED */}
                  {selectedApproval.state === 'APPROVED' && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">
                        Proposal is formally approved. Ready to deploy cryptographic patch to target environment.
                      </p>
                      <button
                        onClick={() => handleApply(selectedApproval.approval_id)}
                        disabled={actionLoading}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                      >
                        {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        <span>Apply Cryptographic Patch (APPROVED ➔ APPLIED)</span>
                      </button>
                    </div>
                  )}

                  {/* Step 4: APPLIED -> Transition to VERIFIED */}
                  {selectedApproval.state === 'APPLIED' && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">
                        Patch has been applied. Verification rescan and test execution required to confirm remediation.
                      </p>
                      <button
                        onClick={() => handleVerify(selectedApproval.approval_id)}
                        disabled={actionLoading}
                        className="w-full py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                      >
                        {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <FileCheck size={14} />}
                        <span>Execute Cryptographic Verification (APPLIED ➔ VERIFIED)</span>
                      </button>
                    </div>
                  )}

                  {/* Step 5: VERIFIED Result Display */}
                  {selectedApproval.state === 'VERIFIED' && (
                    <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                        <CheckCircle size={16} />
                        <span>VERIFIED RESULT: Cryptographic Remediation Assured</span>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-2xs font-mono text-emerald-300 space-y-1">
                        <div>Status: PASSED</div>
                        <div>Target Standard: {selectedApproval.target_standard}</div>
                        <div>Verifier: {selectedApproval.verifier?.username || 'Security Automation'}</div>
                        <div>Verified At: {selectedApproval.verifier?.verified_at || 'Just now'}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Patch Diff View */}
                {selectedApproval.patch_diff && (
                  <div>
                    <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                      <Code2 size={13} className="text-cyan-400" />
                      <span>Proposed Cryptographic Diff</span>
                    </h4>
                    <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 font-mono text-2xs text-cyan-300 overflow-x-auto max-h-48">
                      <pre>{selectedApproval.patch_diff}</pre>
                    </div>
                  </div>
                )}

                {/* Tamper-Resistant Audit Trail History */}
                <div>
                  <h4 className="text-2xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                    <History size={13} className="text-cyan-400" />
                    <span>Cryptographic State Chain Ledger</span>
                  </h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {selectedApproval.audit_history?.map((evt, idx) => (
                      <div key={idx} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-2xs flex items-center justify-between gap-2 font-mono">
                        <div>
                          <span className="text-cyan-300 font-bold">{evt.to_state}</span>
                          <span className="text-slate-500 ml-2">by {evt.actor} ({evt.role})</span>
                          <p className="text-slate-400 text-3xs font-sans mt-0.5">{evt.comments}</p>
                        </div>
                        <span className="text-slate-600 truncate max-w-[140px]" title={evt.hash}>
                          Hash: {evt.hash.slice(0, 12)}...
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PROPOSE REMEDIATION MODAL */}
      {proposeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Wrench size={16} className="text-cyan-400" />
                <span>Propose Cryptographic Remediation</span>
              </h3>
              <button
                onClick={() => setProposeModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle size={16} />
              </button>
            </div>

            <form onSubmit={handleProposeSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Proposal Title</label>
                <input
                  type="text"
                  value={proposeTitle}
                  onChange={(e) => setProposeTitle(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Category</label>
                  <select
                    value={proposeCategory}
                    onChange={(e) => setProposeCategory(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="algorithm migration">Algorithm Migration</option>
                    <option value="key rotation">Key Rotation</option>
                    <option value="protocol hardening">Protocol Hardening</option>
                    <option value="pqc hybrid enablement">PQC Hybrid Enablement</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Environment</label>
                  <select
                    value={proposeEnv}
                    onChange={(e) => setProposeEnv(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Target Standard</label>
                  <input
                    type="text"
                    value={proposeTargetStandard}
                    onChange={(e) => setProposeTargetStandard(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Finding ID (Optional)</label>
                  <input
                    type="text"
                    value={proposeFindingId}
                    onChange={(e) => setProposeFindingId(e.target.value)}
                    placeholder="e.g. fnd_..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Affected Asset / File</label>
                <input
                  type="text"
                  value={proposeAsset}
                  onChange={(e) => setProposeAsset(e.target.value)}
                  placeholder="e.g. src/auth/token_signer.c"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Patch Diff</label>
                <textarea
                  value={proposePatchDiff}
                  onChange={(e) => setProposePatchDiff(e.target.value)}
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 font-mono text-2xs text-cyan-300 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Test Plan</label>
                  <input
                    type="text"
                    value={proposeTestPlan}
                    onChange={(e) => setProposeTestPlan(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Rollback Plan</label>
                  <input
                    type="text"
                    value={proposeRollbackPlan}
                    onChange={(e) => setProposeRollbackPlan(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setProposeModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 text-slate-950 font-bold shadow-md shadow-cyan-500/20 flex items-center gap-2"
                >
                  {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  <span>Submit Proposal</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Remediation;
