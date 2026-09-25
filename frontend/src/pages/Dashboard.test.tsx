import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard } from './Dashboard';
import { api } from '../api/client';
import type { DashboardViewsResponse } from '../types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => ({}) };
});

vi.mock('../api/client', () => ({
  api: {
    getDashboardViews: vi.fn(),
    getDashboardSummary: vi.fn(),
    triggerNetworkScan: vi.fn(),
  },
}));

const mockViewsData: DashboardViewsResponse = {
  scan_id: 'scan-demo-17',
  scan_name: 'Enterprise Crypto Core & APIs',
  policy_profile: 'regulated_bfsi',
  threat_horizon: 'baseline',
  created_at: new Date().toISOString(),
  views: {
    executive_overview: {
      posture_score: 82,
      posture_rating: 'STRONG',
      pqc_readiness_pct: 75,
      total_assets: 4,
      total_findings: 5,
      critical_findings: 1,
      high_findings: 2,
      medium_findings: 1,
      low_findings: 1,
      info_findings: 0,
      quantum_risk_count: 2,
      overall_cicd_pass: false,
      quick_wins_count: 2,
      kpis: [
        {
          id: 'kpi_critical_findings',
          title: 'Critical Findings',
          value: 1,
          status: 'critical',
          evidenceCount: 1,
          evidence_items: ['find_rsa_1024'],
        },
        {
          id: 'kpi_quantum_threat',
          title: 'At Quantum Threat Horizon',
          value: 2,
          status: 'warning',
          evidenceCount: 2,
          evidence_items: ['find_rsa_1024', 'find_rsa_2048'],
        },
      ],
    },
    crypto_inventory: {
      total_components: 2,
      components: [
        {
          id: 'comp_1',
          name: 'RSA-1024',
          algorithm: 'RSA',
          key_size: 1024,
          primitive: 'algorithm',
          asset_id: 'svc_auth',
          location: 'auth/token.go',
          line_number: 42,
          severity: 'Critical',
          mosca_status: 'CRITICAL_URGENT',
          quantum_relevance: 'Shor Vulnerable',
          finding_id: 'find_rsa_1024',
        },
      ],
    },
    application_inventory: {
      total_applications: 1,
      applications: [
        {
          id: 'svc_auth',
          name: 'Auth Service',
          type: 'microservice',
          sensitivity: 'auth_credentials',
          criticality: 'critical',
          severity: 'Critical',
          at_quantum_risk: true,
          owner: 'Security Team',
          blast_radius: 12,
          dependencies: 4,
          crypto_findings_count: 1,
          evidence_items: ['find_rsa_1024'],
        },
      ],
    },
    risk_heatmap: {
      total_cells: 16,
      active_hotspots_count: 1,
      matrix: [
        {
          key: 'critical_urgent',
          impact: 'Critical',
          likelihood: 'Urgent',
          count: 1,
          colorClass: 'bg-rose-500',
          evidence_items: ['find_rsa_1024'],
        },
      ],
    },
    pqc_readiness: {
      overall_readiness_score: 75,
      shor_vulnerable_count: 1,
      shor_evidence: ['find_rsa_1024'],
      grover_vulnerable_count: 0,
      grover_evidence: [],
      pqc_safe_count: 1,
      pqc_evidence: ['find_kyber'],
      hybrid_adoption_count: 1,
      nist_standards_alignment: [
        { standard: 'NIST FIPS 203 (ML-KEM)', target: 'Kyber-768', status: 'ADOPTING', evidenceCount: 1 },
      ],
      mosca_timeline: [
        {
          finding_id: 'find_rsa_1024',
          asset_id: 'svc_auth',
          algorithm: 'RSA-1024',
          x_shelf_life_years: 5,
          y_migration_years: 3,
          z_quantum_threat_years: 6,
          margin_years: -2,
          status: 'CRITICAL_URGENT',
        },
      ],
    },
    certificates: {
      total_certificates: 1,
      expired_count: 0,
      expiring_soon_count: 1,
      weak_keys_count: 0,
      certificates: [
        {
          fingerprint_sha256: 'ABCD',
          subject_dn: 'CN=api.ecdat.io',
          issuer_dn: 'CN=DigiCert',
          validity_start: '2025-01-01',
          validity_end: '2026-10-01',
          days_remaining: 45,
          algorithm: 'RSA',
          key_size: 2048,
          renewal_state: 'EXPIRING_SOON',
          detected_anomalies: ['expiring_soon'],
          evidence_link: 'https://api.ecdat.io:443',
        },
      ],
    },
    algorithms: {
      total_distinct_algorithms: 1,
      algorithms: [
        {
          name: 'RSA-1024',
          primitive: 'algorithm',
          count: 1,
          classical_risk: 'Critical',
          quantum_relevance: 'Shor Vulnerable',
          target_replacement: 'ML-KEM-768',
          evidence_occurrences: [
            { finding_id: 'find_rsa_1024', asset_id: 'svc_auth', location: 'auth/token.go', line_number: 42 },
          ],
        },
      ],
    },
    network_endpoints: {
      total_endpoints: 1,
      endpoints: [
        {
          id: 'ep_1',
          host: 'api.ecdat.io',
          port: 443,
          protocol: 'HTTPS',
          tls_version: 'TLS 1.3',
          cipher_suites_count: 5,
          weak_ciphers_detected: 0,
          pfs_supported: true,
          hybrid_supported: true,
          cert_fingerprint: 'ABCD',
          evidence_finding_id: 'find_rsa_1024',
        },
      ],
    },
    runtime_observations: {
      total_observations: 1,
      observations: [
        {
          id: 'obs_1',
          observation_type: 'PROCESS_CALL',
          target: 'svc_auth',
          component: 'crypto/rsa',
          details: 'Live RSA generation observed',
          reachability_confirmed: true,
          timestamp: new Date().toISOString(),
          evidence_id: 'find_rsa_1024',
        },
      ],
    },
    policy_violations: {
      active_profile: 'regulated_bfsi',
      total_violations: 1,
      blocking_violations_count: 1,
      violations: [
        {
          rule_id: 'RULE_MIN_RSA_2048',
          rule_name: 'Minimum RSA Key Size',
          description: 'Keys below 2048-bit are prohibited',
          severity: 'Critical',
          threshold: 'FAIL_CI_HIGH',
          affected_count: 1,
          evidence_items: ['find_rsa_1024'],
        },
      ],
    },
    remediation: {
      total_remediations: 1,
      quick_wins_count: 1,
      complex_migrations_count: 0,
      quick_wins: [
        {
          id: 'rem_1',
          finding_id: 'find_rsa_1024',
          asset_id: 'svc_auth',
          algorithm: 'RSA-1024',
          recommended_target: 'RSA-4096',
          complexity: 'LOW',
          category: 'Quick Win',
          patch_available: true,
          patch_diff: '- rsa(1024)\n+ rsa(4096)',
          rationale: 'Upgrade key size',
        },
      ],
      complex_migrations: [],
    },
    ownership: {
      total_teams: 1,
      unowned_assets_count: 0,
      teams: [
        {
          team_name: 'Security Team',
          lead: 'sec@ecdat.corp',
          asset_count: 1,
          critical_count: 1,
          high_count: 0,
          total_findings: 1,
          sla_compliance_pct: 75,
          evidence_asset_ids: ['svc_auth'],
        },
      ],
    },
    audit_trail: {
      total_events: 1,
      events: [
        {
          id: 'evt_1',
          event_type: 'SCAN_INGESTED',
          table_name: 'scans',
          record_id: 'scan-demo-17',
          actor: 'sec-ops-runner',
          action: 'INSERT',
          status: 'SUCCESS',
          created_at: new Date().toISOString(),
        },
      ],
    },
  },
  evidence_lookup: {
    find_rsa_1024: {
      id: 'find_rsa_1024',
      algorithm: 'RSA-1024',
      key_size: 1024,
      category: 'algorithm',
      severity: 'Critical',
      mosca_status: 'CRITICAL_URGENT',
      classical_risk: 'Critical',
      quantum_relevance: 'Shor Vulnerable',
      location: 'auth/token.go',
      line_number: 42,
      evidence_context: 'rsa.GenerateKey(rand.Reader, 1024)',
      asset_id: 'svc_auth',
    },
  },
};

describe('Phase 17.1 — Enterprise Security Dashboard UI', () => {
  beforeEach(() => {
    vi.mocked(api.getDashboardViews).mockReset();
  });

  it('renders enterprise dashboard and all 13 view navigation tabs', async () => {
    vi.mocked(api.getDashboardViews).mockResolvedValue(mockViewsData);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    // Verify main enterprise banner
    await waitFor(() =>
      expect(
        screen.getByText('Cryptographic Security & PQC Executive Center')
      ).toBeInTheDocument()
    );

    // Verify all 13 views are in navigation tabs
    const requiredTabLabels = [
      'Executive Overview',
      'Crypto Inventory',
      'Application Inventory',
      'Risk Heatmap',
      'PQC Readiness',
      'Certificates',
      'Algorithms',
      'Network Endpoints',
      'Runtime Observations',
      'Policy Violations',
      'Remediation',
      'Ownership',
      'Audit Trail',
    ];

    for (const label of requiredTabLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('opens EvidenceDrawer when any metric or finding evidence is clicked', async () => {
    vi.mocked(api.getDashboardViews).mockResolvedValue(mockViewsData);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(
        screen.getByText('Cryptographic Security & PQC Executive Center')
      ).toBeInTheDocument()
    );

    // Click Critical Findings KPI card which links to evidence
    const critCard = screen.getAllByText('Critical Findings')[0];
    fireEvent.click(critCard);

    // Evidence Drawer should open with the exact line number and code snippet
    await waitFor(() => {
      expect(screen.getByText(/1 Finding Linked/i)).toBeInTheDocument();
      expect(screen.getByText('rsa.GenerateKey(rand.Reader, 1024)')).toBeInTheDocument();
      expect(screen.getByText(/:line 42/i)).toBeInTheDocument();
    });
  });

  it('renders loading state when views are being fetched', async () => {
    let resolveViews: (value: DashboardViewsResponse) => void;
    const pendingPromise = new Promise<DashboardViewsResponse>((resolve) => {
      resolveViews = resolve;
    });
    vi.mocked(api.getDashboardViews).mockReturnValue(pendingPromise);

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    );

    expect(screen.getByText('Synthesizing Enterprise Cryptographic Evidence...')).toBeInTheDocument();

    resolveViews!(mockViewsData);
    await screen.findByText('Cryptographic Security & PQC Executive Center');
  });
});
