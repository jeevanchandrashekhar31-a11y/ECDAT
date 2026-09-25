import {
  DashboardSummary,
  AssetsResponse,
  AssetDetail,
  FindingsResponse,
  FindingItem,
  ScanItem,
  Metrics,
  DashboardViewsResponse,
  CryptoGraphResponse,
  RemediationApprovalsResponse,
  RemediationApprovalRecord,
  ApprovalState,
} from '../types';
import {
  purgeLocalStorageSecrets,
  attachCsrfHeader,
  setCsrfToken,
  authManager,
  isSafeUrl,
} from '../security';

// Immediately audit and clear any unauthorized credentials placed in localStorage or sessionStorage
if (typeof window !== 'undefined') {
  purgeLocalStorageSecrets();
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// Legacy helper kept for backward compatibility; returns null when no key configured
export function getSessionApiKey(): string | null {
  return null;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // Enforce safe URL and path handling
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!isSafeUrl(cleanEndpoint, { allowRelative: true })) {
    throw new Error(`[Security Violation] Blocked unsafe API request target: ${cleanEndpoint}`);
  }

  const url = `${API_BASE}${cleanEndpoint}`;
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  // 1. Double Submit Cookie CSRF Defense (mutating requests)
  attachCsrfHeader(headers, method);

  // 2. Strict API Authorization & Multi-Tenancy headers (Bearer token from in-memory store)
  authManager.attachAuthHeaders(headers);

  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    let backendError: Record<string, unknown> | null = null;
    try {
      const errBody = await response.json();
      backendError = errBody;
      if (errBody) {
        if (errBody.message && errBody.error && errBody.error !== errBody.message) {
          errorMsg = `${errBody.error}: ${errBody.message}`;
        } else if (errBody.message) {
          errorMsg = errBody.message;
        } else if (errBody.error) {
          errorMsg = errBody.error;
        }
      }
    } catch {
      // not json
    }

    // User-facing normalized message for 401 in UI context
    if (response.status === 401) {
      errorMsg = 'Session expired or authentication required. Please sign in.';
    } else if (response.status >= 500) {
      // Sanitize backend 5xx errors to prevent leaking raw stack traces to users
      errorMsg = 'An unexpected system error occurred while processing your request. Please try again or contact the platform team.';
    } else if (/at .*:\d+:\d+/.test(errorMsg) || /Error:/.test(errorMsg)) {
      // Catch any stray stack traces leaking in 4xx responses
      errorMsg = 'A request validation error occurred. Please verify your input and try again.';
    }

    // Intercept 401 Unauthorized / 403 Forbidden
    authManager.handleResponseStatus(response.status, errorMsg);

    const error = new Error(errorMsg);
    (error as unknown as { status: number; data?: unknown }).status = response.status;
    (error as unknown as { status: number; data?: unknown }).data = backendError;
    throw error;
  }

  // If response is text/html (like reports)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    return (await response.text()) as unknown as T;
  }

  const data = (await response.json()) as T;
  if (
    data &&
    typeof data === 'object' &&
    'csrfToken' in data &&
    typeof (data as { csrfToken?: unknown }).csrfToken === 'string'
  ) {
    setCsrfToken((data as { csrfToken: string }).csrfToken);
  }
  return data;
}

export const api = {
  // Health
  getHealth: async (): Promise<{ status: string; version: string; service: string }> => {
    return request('/health');
  },

  // Dashboard
  getDashboardSummary: async (
    scanId?: string,
    policyProfile?: string,
    deploymentContext?: string,
    threatHorizon?: string
  ): Promise<DashboardSummary> => {
    const params = new URLSearchParams();
    if (scanId) params.append('scanId', scanId);
    if (policyProfile) params.append('policyProfile', policyProfile);
    if (deploymentContext) params.append('deploymentContext', deploymentContext);
    if (threatHorizon) params.append('threatHorizon', threatHorizon);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<DashboardSummary>(`/api/v1/dashboard/summary${query}`);
  },

  getDashboardViews: async (
    scanId?: string,
    policyProfile?: string,
    deploymentContext?: string,
    threatHorizon?: string
  ): Promise<DashboardViewsResponse> => {
    const params = new URLSearchParams();
    if (scanId) params.append('scanId', scanId);
    if (policyProfile) params.append('policyProfile', policyProfile);
    if (deploymentContext) params.append('deploymentContext', deploymentContext);
    if (threatHorizon) params.append('threatHorizon', threatHorizon);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<DashboardViewsResponse>(`/api/v1/dashboard/views${query}`);
  },

  getCryptoGraph: async (params: {
    scanId?: string;
    severity?: string;
    owner?: string;
    environment?: string;
    algorithm?: string;
    pqcReadiness?: string;
    exposure?: string;
    search?: string;
  } = {}): Promise<CryptoGraphResponse> => {
    const q = new URLSearchParams();
    if (params.scanId) q.append('scanId', params.scanId);
    if (params.severity && params.severity !== 'ALL') q.append('severity', params.severity);
    if (params.owner && params.owner !== 'ALL') q.append('owner', params.owner);
    if (params.environment && params.environment !== 'ALL') q.append('environment', params.environment);
    if (params.algorithm && params.algorithm !== 'ALL') q.append('algorithm', params.algorithm);
    if (params.pqcReadiness && params.pqcReadiness !== 'ALL') q.append('pqcReadiness', params.pqcReadiness);
    if (params.exposure && params.exposure !== 'ALL') q.append('exposure', params.exposure);
    if (params.search && params.search.trim()) q.append('search', params.search.trim());
    const query = q.toString() ? `?${q.toString()}` : '';
    return request<CryptoGraphResponse>(`/api/v1/graph${query}`);
  },

  // Assets
  getAssets: async (
    params: {
      scanId?: string;
      severity?: string;
      moscaStatus?: string;
      assetType?: string;
      source?: string;
      dataSensitivity?: string;
      businessCriticality?: string;
      sortBy?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<AssetsResponse> => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    });
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<AssetsResponse>(`/api/v1/assets${query}`);
  },

  getAssetById: async (assetId: string, scanId?: string): Promise<AssetDetail> => {
    const query = scanId ? `?scanId=${encodeURIComponent(scanId)}` : '';
    return request<AssetDetail>(`/api/v1/assets/${encodeURIComponent(assetId)}${query}`);
  },

  // Findings
  getFindings: async (
    params: {
      scanId?: string;
      severity?: string;
      algorithm?: string;
      moscaStatus?: string;
      assetType?: string;
      source?: string;
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<FindingsResponse> => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') {
        searchParams.append(key, String(val));
      }
    });
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return request<FindingsResponse>(`/api/v1/findings${query}`);
  },

  getFindingById: async (findingId: string): Promise<FindingItem> => {
    return request<FindingItem>(`/api/v1/findings/${encodeURIComponent(findingId)}`);
  },

  reviewFinding: async (findingId: string, action: 'CONFIRM' | 'DISMISS', reason?: string): Promise<{ success: boolean; message: string }> => {
    return request<{ success: boolean; message: string }>(`/api/v1/findings/${encodeURIComponent(findingId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    });
  },

  // Scans
  getScans: async (): Promise<{ total: number; scans: ScanItem[] }> => {
    return request<{ total: number; scans: ScanItem[] }>('/api/v1/scans');
  },

  getScanById: async (scanId: string): Promise<ScanItem> => {
    return request<ScanItem>(`/api/v1/scans/${encodeURIComponent(scanId)}`);
  },

  getScanErrors: async (scanId: string): Promise<{ scan_id: string; total_errors: number; errors: unknown[] }> => {
    return request(`/api/v1/scans/${encodeURIComponent(scanId)}/errors`);
  },

  // Reports
  getReportsSummary: async (scanId?: string): Promise<unknown> => {
    const query = scanId ? `?scanId=${encodeURIComponent(scanId)}` : '';
    return request(`/api/v1/reports/summary${query}`);
  },

  getReportHtml: async (scanId: string): Promise<string> => {
    return request<string>(`/api/v1/reports/${encodeURIComponent(scanId)}/html`);
  },

  getReportCbom: async (scanId: string, type: 'annotated' | 'raw' = 'annotated'): Promise<unknown> => {
    return request(`/api/v1/reports/cbom/${encodeURIComponent(scanId)}?type=${type}`);
  },

  // Ingestion / Upload
  uploadCbom: async (
    file: File | object,
    options: {
      scanLabel?: string;
      scannerType?: string;
      projectName?: string;
      policyProfile?: string;
      deploymentContext?: string;
      threatHorizon?: string;
      businessCriticality?: string;
    } = {}
  ): Promise<{ message: string; scan_id: string }> => {
    if (file instanceof File) {
      const formData = new FormData();
      formData.append('file', file);
      if (options.scanLabel) formData.append('scan_label', options.scanLabel);
      if (options.scannerType) formData.append('scanner_type', options.scannerType);
      if (options.projectName) formData.append('project_name', options.projectName);
      if (options.policyProfile) formData.append('policy_profile', options.policyProfile);
      if (options.deploymentContext) formData.append('deployment_context', options.deploymentContext);
      if (options.threatHorizon) formData.append('threat_horizon', options.threatHorizon);
      if (options.businessCriticality) formData.append('business_criticality', options.businessCriticality);

      return request('/api/v1/cboms', {
        method: 'POST',
        body: formData,
      });
    } else {
      const params = new URLSearchParams();
      if (options.policyProfile) params.append('policy_profile', options.policyProfile);
      if (options.deploymentContext) params.append('deployment_context', options.deploymentContext);
      if (options.threatHorizon) params.append('threat_horizon', options.threatHorizon);
      if (options.businessCriticality) params.append('business_criticality', options.businessCriticality);
      const query = params.toString() ? `?${params.toString()}` : '';

      return request(`/api/v1/cboms${query}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...file,
          scan_label: options.scanLabel,
          scanner_type: options.scannerType,
          project_name: options.projectName,
        }),
      });
    }
  },

  // --------------------------------------------------------------------------
  // Live Scanner Pipeline Triggers & CBOM Operations
  // --------------------------------------------------------------------------
  triggerStaticScan: async (
    target?: string | File | File[],
    options: {
      github_url?: string;
      scan_label?: string;
      policy_profile?: string;
      deployment_context?: string;
      threat_horizon?: string;
      business_criticality?: string;
    } = {}
  ): Promise<{
    success: boolean;
    message: string;
    scan_source: string;
    scan_id: string;
    metrics: Metrics;
    cbom: unknown;
  }> => {
    // If files or a zip file are provided
    if (target instanceof File || (Array.isArray(target) && target.length > 0 && target[0] instanceof File)) {
      const formData = new FormData();
      if (Array.isArray(target)) {
        for (const f of target) {
          formData.append('files', f);
        }
      } else {
        formData.append('files', target);
      }
      if (options.scan_label) formData.append('scan_label', options.scan_label);
      if (options.policy_profile) formData.append('policy_profile', options.policy_profile);
      if (options.deployment_context) formData.append('deployment_context', options.deployment_context);
      if (options.threat_horizon) formData.append('threat_horizon', options.threat_horizon);
      if (options.business_criticality) formData.append('business_criticality', options.business_criticality);

      return request('/scan/static', {
        method: 'POST',
        body: formData,
      });
    }

    // JSON payload for Git URL or optional path
    const rawTarget = typeof target === 'string' ? target.trim() : '';
    const isGit = Boolean(
      options.github_url ||
      (rawTarget && (rawTarget.startsWith('http') || rawTarget.includes('github.com') || rawTarget.includes('gitlab.com') || rawTarget.startsWith('git@') || rawTarget.endsWith('.git')))
    );
    const gitUrl = options.github_url || (isGit ? rawTarget : undefined);
    const targetDir = !isGit && rawTarget ? rawTarget : undefined;

    const payload: Record<string, unknown> = { ...options };
    if (gitUrl) payload.github_url = gitUrl;
    if (targetDir) payload.target_dir = targetDir;

    return request('/scan/static', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  },

  triggerNetworkScan: async (
    targetOrHost?: string,
    port?: number,
    options: { scan_label?: string; policy_profile?: string; deployment_context?: string; threat_horizon?: string; business_criticality?: string; authorized_by?: string } = {}
  ): Promise<{
    success: boolean;
    message: string;
    scan_source: string;
    scan_id: string;
    metrics: Metrics;
    cbom: unknown;
  }> => {
    const session = authManager.getSession();
    const authorized_by = options.authorized_by?.trim() || session.userId || 'Evaluation Executive';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { authorized_by: _ignored, ...restOptions } = options;
    return request('/scan/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...restOptions,
        url: targetOrHost,
        host: targetOrHost,
        port,
        authorized_by,
      }),
    });
  },

  triggerBinaryScan: async (
    target?: string | File | File[],
    options: { scan_label?: string; policy_profile?: string; deployment_context?: string; threat_horizon?: string; business_criticality?: string; image?: string } = {}
  ): Promise<{
    success: boolean;
    message: string;
    scan_source: string;
    scan_id: string;
    metrics: Metrics;
    cbom: unknown;
  }> => {
    if (target instanceof File || (Array.isArray(target) && target.length > 0 && target[0] instanceof File)) {
      const formData = new FormData();
      if (Array.isArray(target)) {
        for (const f of target) {
          formData.append('files', f);
        }
      } else {
        formData.append('files', target);
      }
      if (options.scan_label) formData.append('scan_label', options.scan_label);
      if (options.policy_profile) formData.append('policy_profile', options.policy_profile);
      if (options.deployment_context) formData.append('deployment_context', options.deployment_context);
      if (options.threat_horizon) formData.append('threat_horizon', options.threat_horizon);
      if (options.business_criticality) formData.append('business_criticality', options.business_criticality);

      return request('/scan/binary', {
        method: 'POST',
        body: formData,
      });
    }

    return request('/scan/binary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: options.image || (typeof target === 'string' && target.includes(':') ? target : undefined),
        target: typeof target === 'string' ? target : undefined,
        ...options,
      }),
    });
  },

  mergeCboms: async (
    cboms?: unknown[],
    options: { scan_name?: string; policy_profile?: string; scenario?: string } = {}
  ): Promise<{
    success: boolean;
    message: string;
    scan_id: string;
    total_merged_components: number;
    metrics: unknown;
    cbom: unknown;
  }> => {
    return request('/cbom/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cboms,
        ...options,
      }),
    });
  },

  evaluateQuantumRisk: async (
    cbom?: unknown,
    options: { scan_name?: string; policy_profile?: string; scenario?: string } = {}
  ): Promise<{
    success: boolean;
    scan_id: string;
    policy_profile: string;
    scenario: string;
    metrics: unknown;
    findings: unknown[];
  }> => {
    return request('/cbom/quantum-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cbom,
        ...options,
      }),
    });
  },

  getMergedCbom: async (): Promise<unknown> => {
    return request('/cbom/merged');
  },

  getRiskSummary: async (): Promise<unknown> => {
    return request('/cbom/risk');
  },

  getPqcReport: async (): Promise<{
    scan_id: string;
    policy_profile: string;
    scenario: string;
    recommendations: unknown[];
    metrics: unknown;
    html_report_url: string;
  }> => {
    return request('/cbom/pqc-report');
  },

  // --------------------------------------------------------------------------
  // Authentication & MFA Surface
  // --------------------------------------------------------------------------
  login: async (username: string, password: string): Promise<{
    mfaRequired?: boolean;
    mfaToken?: string;
    userId?: string;
    username?: string;
    accessToken?: string;
    refreshToken?: string;
    csrfToken?: string;
    user?: {
      userId: string;
      username: string;
      email?: string;
      roles?: string[];
      tenantId?: string;
    };
  }> => {
    return request('/api/v1/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  },

  mfaVerify: async (
    mfaToken: string,
    code: string,
    isBackupCode: boolean = false
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    csrfToken?: string;
    user: {
      userId: string;
      username: string;
      email?: string;
      roles?: string[];
    };
  }> => {
    return request('/api/v1/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, code, isBackupCode }),
    });
  },

  mfaSetup: async (userId?: string): Promise<{
    secret: string;
    otpAuthUri: string;
    issuer: string;
    digits: number;
    period: number;
    backupCodes: string[];
    instructions: string;
  }> => {
    return request('/api/v1/auth/mfa/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userId ? { userId } : {}),
    });
  },

  mfaEnable: async (
    code: string,
    userId?: string
  ): Promise<{
    success: boolean;
    message: string;
    mfaEnabled: boolean;
  }> => {
    return request('/api/v1/auth/mfa/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(userId ? { userId } : {}) }),
    });
  },

  mfaReset: async (
    params: {
      userId?: string;
      code?: string;
      password?: string;
      isBackupCode?: boolean;
      reason?: string;
    } = {}
  ): Promise<{
    success: boolean;
    message: string;
    mfaEnabled: boolean;
  }> => {
    return request('/api/v1/auth/mfa/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  },

  logout: async (): Promise<{ success: boolean; message: string }> => {
    return request('/api/v1/auth/logout', {
      method: 'POST',
    });
  },

  getCsrfToken: async (): Promise<{ csrfToken: string }> => {
    return request('/api/v1/auth/csrf-token');
  },

  getCurrentUser: async (): Promise<{
    authenticated: boolean;
    mode: string;
    role: string;
    roles: string[];
    user: {
      userId: string;
      username?: string;
      email?: string;
      roles?: string[];
      tenantId?: string;
      isDemo?: boolean;
      isEvaluation?: boolean;
    };
  }> => {
    return request('/api/v1/auth/me');
  },

  // --------------------------------------------------------------------------
  // Evaluation Environment One-Click Authentication & Governance
  // --------------------------------------------------------------------------
  enterEvaluation: async (
    persona: string = 'analyst',
    seed: boolean = true
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    csrfToken?: string;
    evaluationMode: boolean;
    user: {
      userId: string;
      username: string;
      displayName: string;
      email: string;
      roles: string[];
      tenantId: string;
      isPlatformAdmin: boolean;
      isEvaluation: boolean;
    };
  }> => {
    return request('/api/v1/auth/evaluation/enter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, seed }),
    });
  },

  switchEvaluationPersona: async (
    persona: string
  ): Promise<unknown> => {
    return request('/api/v1/auth/evaluation/persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ persona, seed: false }),
    });
  },

  resetEvaluationTenant: async (): Promise<{ success: boolean; message: string }> => {
    return request('/api/v1/auth/evaluation/reset', {
      method: 'POST',
    });
  },

  seedEvaluationTenant: async (): Promise<{ success: boolean; scan_id: string; message: string }> => {
    return request('/api/v1/auth/evaluation/seed', {
      method: 'POST',
    });
  },

  // --------------------------------------------------------------------------
  // Safe Remediation & Four-Eyes Governance Lifecycle
  // --------------------------------------------------------------------------
  getRemediationApprovals: async (filters: {
    state?: string;
    category?: string;
    environment?: string;
  } = {}): Promise<RemediationApprovalsResponse> => {
    const params = new URLSearchParams();
    if (filters.state && filters.state !== 'ALL') params.append('state', filters.state);
    if (filters.category && filters.category !== 'ALL') params.append('category', filters.category);
    if (filters.environment && filters.environment !== 'ALL') params.append('environment', filters.environment);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<RemediationApprovalsResponse>(`/api/v1/remediation/approvals${query}`);
  },

  getRemediationApprovalById: async (
    approvalId: string
  ): Promise<{
    success: boolean;
    approval: RemediationApprovalRecord;
    chain_verification: {
      valid: boolean;
      total_transitions: number;
      genesis_hash?: string;
      head_hash?: string;
    };
  }> => {
    return request(`/api/v1/remediation/approvals/${encodeURIComponent(approvalId)}`);
  },

  proposeRemediation: async (data: {
    title: string;
    description?: string;
    category?: string;
    environment?: string;
    finding_id?: string | null;
    affected_asset?: string | null;
    target_standard?: string | null;
    patch_diff?: string | null;
    test_plan?: string | null;
    rollback_plan?: string | null;
    comments?: string;
  }): Promise<{ success: boolean } & RemediationApprovalRecord> => {
    return request('/api/v1/remediation/approvals/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  reviewRemediation: async (
    approvalId: string,
    comments?: string
  ): Promise<{ success: boolean; state: ApprovalState; approval: RemediationApprovalRecord }> => {
    return request(`/api/v1/remediation/approvals/${encodeURIComponent(approvalId)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: comments || 'Peer review completed.' }),
    });
  },

  approveRemediation: async (
    approvalId: string,
    comments?: string
  ): Promise<{ success: boolean; state: ApprovalState; approval: RemediationApprovalRecord }> => {
    return request(`/api/v1/remediation/approvals/${encodeURIComponent(approvalId)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: comments || 'Approved for execution.' }),
    });
  },

  applyRemediation: async (
    approvalId: string
  ): Promise<{ success: boolean; state: ApprovalState; approval: RemediationApprovalRecord }> => {
    return request(`/api/v1/remediation/approvals/${encodeURIComponent(approvalId)}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  },

  verifyRemediation: async (
    approvalId: string,
    verification_results: Record<string, unknown>
  ): Promise<{ success: boolean; state: ApprovalState; approval: RemediationApprovalRecord }> => {
    return request(`/api/v1/remediation/approvals/${encodeURIComponent(approvalId)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verification_results }),
    });
  },

  getRemediationPlanForFinding: async (
    findingId: string
  ): Promise<{
    success: boolean;
    plan: {
      finding_id: string;
      dimensions: Record<string, unknown>;
      suggested_patch?: string;
      rollback_procedure?: string;
    };
  }> => {
    return request(`/api/v1/remediation/plan/${encodeURIComponent(findingId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dry_run: true }),
    });
  },

  getBlastRadius: async (params: { scanId?: string; quantumArrivalYear: number }): Promise<{ projection: Array<{id: string, status: string, margin?: number}> }> => {
    const searchParams = new URLSearchParams();
    if (params.scanId) searchParams.set('scanId', params.scanId);
    searchParams.set('quantum_arrival_year', params.quantumArrivalYear.toString());
    return request(`/api/v1/blast-radius?${searchParams.toString()}`);
  },

  rerunLiveAnalysis: async (findingId: string): Promise<{ success: boolean; message: string }> => {
    return request(`/api/v1/findings/${encodeURIComponent(findingId)}/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
