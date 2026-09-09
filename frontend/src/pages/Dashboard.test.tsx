import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { api } from '../api/client';
import type { DashboardSummary } from '../types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => ({}) };
});

vi.mock('../api/client', () => ({ api: { getDashboardSummary: vi.fn() } }));

const summary: DashboardSummary = {
  scan_id: 'scan-demo',
  scan_name: 'Demo Scan',
  policy_profile: '',
  scenario: 'baseline',
  metrics: {
    total_assets: 2,
    total_findings: 3,
    critical_findings: 1,
    assets_at_quantum_risk: 1,
    severity_counts: { critical: 1, high: 1, medium: 1, low: 0, informational: 0 },
    mosca_status_counts: { SAFE: 1, WATCH: 0, AT_RISK: 1, CRITICAL_URGENT: 0 },
    overall_cicd_pass: false,
  },
  findings_by_source: { network: 1, static: 2, 'binary-container': 0 },
  most_common_risky_algorithms: [{ algorithm: 'MD5', count: 1 }],
  top_affected_services: [{ name: 'demo-api', severity: 'Critical', type: 'application' }],
  risk_trend: [],
  top_risky_assets: [],
  recommendations: [],
  mosca_analysis_table: [],
};

describe('Dashboard smoke states', () => {
  beforeEach(() => vi.mocked(api.getDashboardSummary).mockReset());

  it('renders dashboard metrics from a successful API response', async () => {
    vi.mocked(api.getDashboardSummary).mockResolvedValue(summary);
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(
        screen.getByText('Cryptographic Discovery & Quantum Risk Engine')
      ).toBeInTheDocument()
    );
    expect(api.getDashboardSummary).toHaveBeenCalledWith(undefined, 'regulated_bfsi', 'baseline');
  });

  it('renders the loading state while response is pending', async () => {
    let resolveSummary: (value: DashboardSummary) => void;
    const pendingResponse = new Promise<DashboardSummary>((resolve) => {
      resolveSummary = resolve;
    });
    vi.mocked(api.getDashboardSummary).mockReturnValue(pendingResponse);
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    resolveSummary!(summary);
    await screen.findByText('Cryptographic Discovery & Quantum Risk Engine');
  });
});
