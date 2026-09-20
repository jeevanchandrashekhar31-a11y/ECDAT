import { DashboardSummary, AssetsResponse, AssetDetail, FindingsResponse, FindingItem, ScanItem, Metrics, DashboardViewsResponse, CryptoGraphResponse } from '../types';
import {
  sessionAuthStorage,
  purgeLocalStorageSecrets,
  attachCsrfHeader,
  authManager,
  isSafeUrl,
} from '../security';

// Immediately audit and clear any unauthorized credentials placed in localStorage
if (typeof window !== 'undefined') {
  purgeLocalStorageSecrets();
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// Tab-scoped & In-Memory Session API Key Management
export function getSessionApiKey(): string | null {
  const existing = sessionAuthStorage.getApiKey();
  if (existing) return existing;

  const envKey = (import.meta.env.VITE_ECDAT_API_KEY as string) || null;
  if (envKey && envKey.trim() !== '') {
    sessionAuthStorage.setApiKey(envKey.trim());
    return envKey.trim();
  }
  return null;
}

export function setSessionApiKey(key: string): void {
  sessionAuthStorage.setApiKey(key);
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

  // 2. Strict API Authorization & Multi-Tenancy headers
  authManager.attachAuthHeaders(headers);

  // 3. Fall back to Session API key if no Authorization or X-API-Key was set
  const apiKey = getSessionApiKey();
  if (apiKey && !headers.has('X-API-Key') && !headers.has('Authorization')) {
    headers.set('X-API-Key', apiKey);
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    try {
      const errBody = await response.json();
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

    // Intercept 401 Unauthorized / 403 Forbidden
    authManager.handleResponseStatus(response.status, errorMsg);

    const error = new Error(errorMsg);
    (error as unknown as { status: number }).status = response.status;
    throw error;
  }

  // If response is text/html (like reports)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    return (await response.text()) as unknown as T;
  }

  return (await response.json()) as T;
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
    scenario?: string
  ): Promise<DashboardSummary> => {
    const params = new URLSearchParams();
    if (scanId) params.append('scanId', scanId);
    if (policyProfile) params.append('policyProfile', policyProfile);
    if (scenario) params.append('scenario', scenario);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<DashboardSummary>(`/api/v1/dashboard/summary${query}`);
  },

  getDashboardViews: async (
    scanId?: string,
    policyProfile?: string,
    scenario?: string
  ): Promise<DashboardViewsResponse> => {
    const params = new URLSearchParams();
    if (scanId) params.append('scanId', scanId);
    if (policyProfile) params.append('policyProfile', policyProfile);
    if (scenario) params.append('scenario', scenario);
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
      scenario?: string;
    } = {}
  ): Promise<{ message: string; scan_id: string }> => {
    if (file instanceof File) {
      const formData = new FormData();
      formData.append('file', file);
      if (options.scanLabel) formData.append('scan_label', options.scanLabel);
      if (options.scannerType) formData.append('scanner_type', options.scannerType);
      if (options.projectName) formData.append('project_name', options.projectName);
      if (options.policyProfile) formData.append('policy_profile', options.policyProfile);
      if (options.scenario) formData.append('scenario', options.scenario);

      return request('/api/v1/cboms', {
        method: 'POST',
        body: formData,
      });
    } else {
      const params = new URLSearchParams();
      if (options.policyProfile) params.append('policy_profile', options.policyProfile);
      if (options.scenario) params.append('scenario', options.scenario);
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
      scenario?: string;
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
      if (options.scenario) formData.append('scenario', options.scenario);

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
    options: { scan_label?: string; policy_profile?: string; scenario?: string; authorized_by?: string } = {}
  ): Promise<{
    success: boolean;
    message: string;
    scan_source: string;
    scan_id: string;
    metrics: Metrics;
    cbom: unknown;
  }> => {
    const session = authManager.getSession();
    const authorized_by = options.authorized_by || session.userId || 'admin';
    return request('/scan/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: targetOrHost,
        host: targetOrHost,
        port,
        authorized_by,
        ...options,
      }),
    });
  },

  triggerBinaryScan: async (
    target?: string | File | File[],
    options: { scan_label?: string; policy_profile?: string; scenario?: string; image?: string } = {}
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
      if (options.scenario) formData.append('scenario', options.scenario);

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
    };
  }> => {
    return request('/api/v1/auth/me');
  },
};
