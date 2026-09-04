import { DashboardSummary, AssetsResponse, AssetDetail, FindingsResponse, FindingItem, ScanItem } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

// Session key helper (never hardcoded in bundle)
const STORAGE_KEY = 'ecdat_session_api_key';

export function getSessionApiKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSessionApiKey(key: string): void {
  try {
    if (!key || key.trim() === '') {
      sessionStorage.removeItem(STORAGE_KEY);
    } else {
      sessionStorage.setItem(STORAGE_KEY, key.trim());
    }
  } catch {
    // ignore
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  // Attach session API key if available
  const apiKey = getSessionApiKey();
  if (apiKey && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', apiKey);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `HTTP Error ${response.status}: ${response.statusText}`;
    try {
      const errBody = await response.json();
      if (errBody && errBody.message) {
        errorMsg = errBody.message;
      }
    } catch {
      // not json
    }
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
};
