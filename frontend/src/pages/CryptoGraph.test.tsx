import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoGraph } from './CryptoGraph';
import { api } from '../api/client';
import type { CryptoGraphResponse } from '../types';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useOutletContext: () => ({ selectedScanId: 'scan-test-graph' }) };
});

vi.mock('../api/client', () => ({
  api: {
    getCryptoGraph: vi.fn(),
  },
}));

const mockGraphResponse: CryptoGraphResponse = {
  scan_id: 'scan-test-graph',
  scan_name: 'Enterprise Core Crypto Scan',
  graph: {
    total_nodes: 6,
    total_edges: 5,
    unfiltered_nodes_count: 6,
    unfiltered_edges_count: 5,
    node_types: {
      application: 1,
      service: 1,
      certificate: 1,
      protocol: 1,
      algorithm: 1,
      data: 1,
    },
    nodes: [
      {
        id: 'app_payments_portal',
        tier: 'Application',
        type: 'application',
        label: 'Payment Gateway App',
        severity: 'Critical',
        pqc_readiness: 'Vulnerable',
        owner: 'Payments-Team',
        environment: 'production',
        exposure: 'public',
        algorithm: 'RSA-1024',
        evidence_items: ['ev_app_01', 'ev_app_02'],
      },
      {
        id: 'svc_auth_service',
        tier: 'Service',
        type: 'service',
        label: 'Auth Microservice',
        severity: 'Critical',
        pqc_readiness: 'Vulnerable',
        owner: 'SecOps',
        environment: 'production',
        exposure: 'internal',
        algorithm: 'ECDSA',
        evidence_items: ['ev_svc_01'],
      },
      {
        id: 'cert_tls_legacy',
        tier: 'Certificate',
        type: 'certificate',
        label: 'Legacy Gateway Cert',
        severity: 'High',
        pqc_readiness: 'Vulnerable',
        owner: 'SecOps',
        environment: 'production',
        exposure: 'public',
        algorithm: 'RSA-2048',
        evidence_items: ['ev_cert_01'],
      },
      {
        id: 'proto_tls_12',
        tier: 'Protocol',
        type: 'protocol',
        label: 'TLS 1.2 Protocol',
        severity: 'Medium',
        pqc_readiness: 'Transitioning',
        owner: 'SecOps',
        environment: 'production',
        exposure: 'public',
        algorithm: 'AES-128-GCM',
        evidence_items: ['ev_proto_01'],
      },
      {
        id: 'algo_rsa_1024',
        tier: 'Algorithm',
        type: 'algorithm',
        label: 'RSA-1024 Signature',
        severity: 'Critical',
        pqc_readiness: 'Vulnerable',
        owner: 'SecOps',
        environment: 'production',
        exposure: 'public',
        algorithm: 'RSA-1024',
        evidence_items: ['ev_algo_01'],
      },
      {
        id: 'data_customer_pan',
        tier: 'Data',
        type: 'data',
        label: 'Customer PAN Records',
        severity: 'Critical',
        pqc_readiness: 'Vulnerable',
        owner: 'DataEng',
        environment: 'production',
        exposure: 'internal',
        algorithm: 'AES-256',
        evidence_items: ['ev_data_01'],
      },
    ],
    edges: [
      {
        id: 'edge_1',
        source: 'app_payments_portal',
        target: 'svc_auth_service',
        relation: 'routes_to',
        severity: 'Critical',
      },
      {
        id: 'edge_2',
        source: 'svc_auth_service',
        target: 'cert_tls_legacy',
        relation: 'presents_cert',
        severity: 'High',
      },
      {
        id: 'edge_3',
        source: 'cert_tls_legacy',
        target: 'proto_tls_12',
        relation: 'negotiates_over',
        severity: 'Medium',
      },
      {
        id: 'edge_4',
        source: 'proto_tls_12',
        target: 'algo_rsa_1024',
        relation: 'implements_algo',
        severity: 'Critical',
      },
      {
        id: 'edge_5',
        source: 'algo_rsa_1024',
        target: 'data_customer_pan',
        relation: 'protects_data',
        severity: 'Critical',
      },
    ],
  },
  filter_metadata: {
    severities: ['Critical', 'High', 'Medium', 'Low', 'Informational'],
    owners: ['SecOps', 'Payments-Team', 'DataEng'],
    environments: ['production', 'staging', 'development'],
    algorithms: ['RSA-1024', 'AES-256-GCM', 'ML-KEM-768'],
    pqc_statuses: ['Vulnerable', 'Transitioning', 'PQC_Ready'],
    exposures: ['public', 'internal', 'dmz'],
  },
  evidence_lookup: {
    ev_app_01: {
      id: 'ev_app_01',
      algorithm: 'TLS-1.0',
      category: 'protocol',
      severity: 'Critical',
      mosca_status: 'CRITICAL_URGENT',
      classical_risk: 'Legacy Protocol with Known BEAST/POODLE Vulnerabilities',
      quantum_relevance: 'Non-quantum safe handshake and key exchange',
      location: 'src/routes/payment_gateway.ts',
      line_number: 44,
      evidence_context: 'const server = tls.createServer({ secureProtocol: "TLSv1_method" });',
    },
    ev_algo_01: {
      id: 'ev_algo_01',
      algorithm: 'RSA-1024',
      category: 'algorithm',
      severity: 'Critical',
      mosca_status: 'CRITICAL_URGENT',
      classical_risk: 'Factoring Vulnerable RSA-1024 Key',
      quantum_relevance: 'Breakable by Shor algorithm',
      location: 'config/keys/signing_key.pem',
      line_number: 1,
      evidence_context: '-----BEGIN RSA PRIVATE KEY----- [REDACTED]',
    },
  },
};

describe('Phase 17.2 — Crypto Graph Visualization UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getCryptoGraph as any).mockResolvedValue(mockGraphResponse);
  });

  it('renders graph header, topology filters, and all 6 pipeline tiers', async () => {
    render(
      <MemoryRouter>
        <CryptoGraph />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Cryptographic Dependency Graph')).toBeInTheDocument();
    });

    // Check all 6 filter selectors exist by label
    expect(screen.getByLabelText(/Severity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Owner/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Environment/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Algorithm/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PQC Readiness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Exposure/i)).toBeInTheDocument();

    // Check all 6 pipeline tier headers
    expect(screen.getAllByText('Application').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Service').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Certificate').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Protocol').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Algorithm').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Data').length).toBeGreaterThanOrEqual(1);
  });

  it('never exposes sensitive raw private keys or secret credentials in labels', async () => {
    render(
      <MemoryRouter>
        <CryptoGraph />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Payment Gateway App')).toBeInTheDocument();
    });

    // Ensure forbidden sensitive strings never appear in DOM
    const rawDom = document.body.innerHTML;
    expect(rawDom).not.toContain('BEGIN PRIVATE KEY');
    expect(rawDom).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(rawDom).not.toContain('secret_api_token');
    expect(rawDom).not.toContain('super_secret_password');
  });

  it('allows clicking a node to inspect details and view evidence findings', async () => {
    render(
      <MemoryRouter>
        <CryptoGraph />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('graph-node-app_payments_portal')).toBeInTheDocument();
    });

    // Click node
    const nodeEl = screen.getByTestId('graph-node-app_payments_portal');
    fireEvent.click(nodeEl);

    // Node drawer opens
    await waitFor(() => {
      expect(screen.getByText('Application Tier')).toBeInTheDocument();
      expect(screen.getByText('Linked Cryptographic Evidence')).toBeInTheDocument();
    });

    // Check inspect button
    const viewEvidenceBtn = screen.getByRole('button', { name: /Inspect in Evidence Drawer/i });
    expect(viewEvidenceBtn).toBeInTheDocument();

    fireEvent.click(viewEvidenceBtn);

    // Slide-over EvidenceDrawer should now be displayed
    await waitFor(() => {
      expect(screen.getByText(/Legacy Protocol with Known BEAST\/POODLE Vulnerabilities/i)).toBeInTheDocument();
    });
  });

  it('triggers filtered api fetch when user selects a filter option', async () => {
    render(
      <MemoryRouter>
        <CryptoGraph />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Cryptographic Dependency Graph')).toBeInTheDocument();
    });

    const severitySelect = screen.getByLabelText(/Severity/i);
    fireEvent.change(severitySelect, { target: { value: 'Critical' } });

    await waitFor(() => {
      expect(api.getCryptoGraph).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'Critical',
        })
      );
    });
  });
});
