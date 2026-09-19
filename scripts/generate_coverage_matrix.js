const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const mounts = [
  { surface: 'Health Probes', prefix: '/health', router: require('../backend/src/routes/health') },
  { surface: 'Metrics & Observability', prefix: '/metrics', router: require('../backend/src/routes/metrics') },
  { surface: 'Scanner Pipeline', prefix: '', router: require('../backend/src/routes/scanner_pipeline') },
  { surface: 'SBOM Management', prefix: '/sbom', router: require('../backend/src/routes/sbom') },
  { surface: 'Telemetry Pipeline', prefix: '/telemetry', router: require('../backend/src/routes/telemetry') },

  // API v1
  { surface: 'Health Probes', prefix: '/api/v1/health', router: require('../backend/src/routes/health') },
  { surface: 'Authentication & Identity', prefix: '/api/v1/auth', router: require('../backend/src/routes/auth') },
  { surface: 'Tenancy & Isolation', prefix: '/api/v1/tenancy', router: require('../backend/src/routes/tenancy') },
  { surface: 'CBOM Management', prefix: '/api/v1/cboms', router: require('../backend/src/routes/cbom') },
  { surface: 'CBOM Operations', prefix: '/api/v1/cbom', router: require('../backend/src/routes/cbom') },
  { surface: 'SBOM Management', prefix: '/api/v1/sbom', router: require('../backend/src/routes/sbom') },
  { surface: 'SBOM Operations', prefix: '/api/v1/sboms', router: require('../backend/src/routes/sbom') },
  { surface: 'Scans', prefix: '/api/v1/scans', router: require('../backend/src/routes/scans') },
  { surface: 'Findings', prefix: '/api/v1/findings', router: require('../backend/src/routes/findings') },
  { surface: 'Assets', prefix: '/api/v1/assets', router: require('../backend/src/routes/assets') },
  { surface: 'Dashboard', prefix: '/api/v1/dashboard', router: require('../backend/src/routes/dashboard') },
  { surface: 'Cryptographic Graph', prefix: '/api/v1/graph', router: require('../backend/src/routes/graph') },
  { surface: 'Reports', prefix: '/api/v1/reports', router: require('../backend/src/routes/reports') },
  { surface: 'Certificates & PKI', prefix: '/api/v1/certificates', router: require('../backend/src/routes/certificates') },
  { surface: 'Policy Engine', prefix: '/api/v1/policy', router: require('../backend/src/routes/policy') },
  { surface: 'Compliance Mapping', prefix: '/api/v1/compliance', router: require('../backend/src/routes/compliance') },
  { surface: 'Remediation', prefix: '/api/v1/remediation', router: require('../backend/src/routes/remediation') },
  { surface: 'CI/CD Gate', prefix: '/api/v1/ci', router: require('../backend/src/routes/ci') },
  { surface: 'Ticketing Integrations', prefix: '/api/v1/integrations/ticketing', router: require('../backend/src/routes/ticketing') },
  { surface: 'KMS Integrations', prefix: '/api/v1/integrations/kms', router: require('../backend/src/routes/kms') },
  { surface: 'Security Hardening', prefix: '/api/v1/security', router: require('../backend/src/routes/security_hardening') },
  { surface: 'Audit Trail', prefix: '/api/v1/audit', router: require('../backend/src/routes/audit') },
  { surface: 'SIEM Integration', prefix: '/api/v1/siem', router: require('../backend/src/routes/siem') },
  { surface: 'Metrics & Observability', prefix: '/api/v1/metrics', router: require('../backend/src/routes/metrics') },
  { surface: 'Telemetry Pipeline', prefix: '/api/v1/telemetry', router: require('../backend/src/routes/telemetry') },
  { surface: 'Scanner Pipeline', prefix: '/api/v1', router: require('../backend/src/routes/scanner_pipeline') },
];

function extractFromRouter(router, prefix = '', surface = '') {
  const routes = [];
  const stack = router.stack || router.router?.stack || [];
  stack.forEach((layer) => {
    if (layer.route) {
      const p = layer.route.path;
      const fullPath = (prefix + (p === '/' ? '' : p)) || '/';
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      methods.forEach((method) => {
        routes.push({ surface, method, path: fullPath });
      });
    }
  });
  return routes;
}

const allBackendRoutes = [];
const seenRoutes = new Set();
mounts.forEach((m) => {
  const routes = extractFromRouter(m.router, m.prefix, m.surface);
  routes.forEach((r) => {
    const key = `${r.method} ${r.path}`;
    if (!seenRoutes.has(key)) {
      seenRoutes.add(key);
      allBackendRoutes.push(r);
    }
  });
});

// Enumerate frontend methods in frontend/src/api/client.ts
const frontendClientMethods = [
  { name: 'getHealth', method: 'GET', endpoint: '/health' },
  { name: 'getDashboardSummary', method: 'GET', endpoint: '/api/v1/dashboard/summary' },
  { name: 'getDashboardViews', method: 'GET', endpoint: '/api/v1/dashboard/views' },
  { name: 'getCryptoGraph', method: 'GET', endpoint: '/api/v1/graph' },
  { name: 'getAssets', method: 'GET', endpoint: '/api/v1/assets' },
  { name: 'getAssetById', method: 'GET', endpoint: '/api/v1/assets/:assetId' },
  { name: 'getFindings', method: 'GET', endpoint: '/api/v1/findings' },
  { name: 'getFindingById', method: 'GET', endpoint: '/api/v1/findings/:findingId' },
  { name: 'getScans', method: 'GET', endpoint: '/api/v1/scans' },
  { name: 'getScanById', method: 'GET', endpoint: '/api/v1/scans/:scanId' },
  { name: 'getScanErrors', method: 'GET', endpoint: '/api/v1/scans/:scanId/errors' },
  { name: 'getReportsSummary', method: 'GET', endpoint: '/api/v1/reports/summary' },
  { name: 'getReportHtml', method: 'GET', endpoint: '/api/v1/reports/:scanId/html' },
  { name: 'getReportCbom', method: 'GET', endpoint: '/api/v1/reports/cbom/:scanId' },
  { name: 'uploadCbom', method: 'POST', endpoint: '/api/v1/cboms' },
  { name: 'triggerStaticScan', method: 'POST', endpoint: '/scan/static' },
  { name: 'triggerNetworkScan', method: 'POST', endpoint: '/scan/network' },
  { name: 'triggerBinaryScan', method: 'POST', endpoint: '/scan/binary' },
  { name: 'mergeCboms', method: 'POST', endpoint: '/cbom/merge' },
  { name: 'evaluateQuantumRisk', method: 'POST', endpoint: '/cbom/quantum-risk' },
  { name: 'getMergedCbom', method: 'GET', endpoint: '/cbom/merged' },
  { name: 'getRiskSummary', method: 'GET', endpoint: '/cbom/risk' },
  { name: 'getPqcReport', method: 'GET', endpoint: '/cbom/pqc-report' },
  { name: 'getSessionApiKey', method: 'N/A', endpoint: 'session_storage' },
  { name: 'setSessionApiKey', method: 'N/A', endpoint: 'session_storage' },
  // Authentication surface methods (implemented in this task)
  { name: 'login', method: 'POST', endpoint: '/api/v1/auth/local/login' },
  { name: 'mfaSetup', method: 'POST', endpoint: '/api/v1/auth/mfa/setup' },
  { name: 'mfaEnable', method: 'POST', endpoint: '/api/v1/auth/mfa/enable' },
  { name: 'mfaVerify', method: 'POST', endpoint: '/api/v1/auth/mfa/verify' },
  { name: 'mfaReset', method: 'POST', endpoint: '/api/v1/auth/mfa/reset' },
  { name: 'logout', method: 'POST', endpoint: '/api/v1/auth/logout' },
  { name: 'getCsrfToken', method: 'GET', endpoint: '/api/v1/auth/csrf-token' },
  { name: 'getCurrentUser', method: 'GET', endpoint: '/api/v1/auth/me' },
];

function normalizePathForMatching(p) {
  return p.replace(/:[a-zA-Z0-9_]+/g, ':param').toLowerCase();
}

// Correlate backend routes with frontend methods
const coveredRoutes = [];
const uncoveredRoutes = [];

allBackendRoutes.forEach((route) => {
  const normBackend = normalizePathForMatching(route.path);
  const matchingClient = frontendClientMethods.find((cm) => {
    if (cm.method !== 'N/A' && cm.method !== route.method) return false;
    const normClient = normalizePathForMatching(cm.endpoint);
    return normBackend === normClient;
  });

  if (matchingClient) {
    coveredRoutes.push({
      ...route,
      covered: true,
      client_method: matchingClient.name,
    });
  } else {
    uncoveredRoutes.push({
      ...route,
      covered: false,
      client_method: null,
    });
  }
});

// Group by functional surface
const surfacesSummary = {};
allBackendRoutes.forEach((r) => {
  if (!surfacesSummary[r.surface]) {
    surfacesSummary[r.surface] = { total_routes: 0, covered_routes: 0, uncovered_routes: 0, status: 'UNCOVERED' };
  }
  surfacesSummary[r.surface].total_routes++;
  const isCov = coveredRoutes.some((cr) => cr.method === r.method && cr.path === r.path);
  if (isCov) {
    surfacesSummary[r.surface].covered_routes++;
  } else {
    surfacesSummary[r.surface].uncovered_routes++;
  }
});

Object.keys(surfacesSummary).forEach((s) => {
  const item = surfacesSummary[s];
  if (item.covered_routes === item.total_routes && item.total_routes > 0) {
    item.status = 'FULLY_COVERED';
  } else if (item.covered_routes > 0) {
    item.status = 'PARTIALLY_COVERED';
  } else {
    item.status = 'UNCOVERED';
  }
});

const coverageMatrix = {
  metadata: {
    generated_at: new Date().toISOString(),
    description: 'ECDAT API Route Coverage Matrix: backend routes vs frontend client methods',
    specification: 'Phase 27.2 Machine-Checkable Coverage Matrix',
    total_backend_routes: allBackendRoutes.length,
    total_frontend_client_methods: frontendClientMethods.length,
    covered_routes_count: coveredRoutes.length,
    uncovered_routes_count: uncoveredRoutes.length,
    coverage_percentage: Number(((coveredRoutes.length / allBackendRoutes.length) * 100).toFixed(2)),
  },
  surface_coverage_summary: surfacesSummary,
  uncovered_surfaces: Object.entries(surfacesSummary)
    .filter(([_, val]) => val.status !== 'FULLY_COVERED')
    .map(([name, val]) => ({
      surface: name,
      status: val.status,
      covered: val.covered_routes,
      uncovered: val.uncovered_routes,
      total: val.total_routes,
    })),
  frontend_client_methods: frontendClientMethods,
  covered_routes: coveredRoutes,
  uncovered_routes: uncoveredRoutes,
};

const outputPath = path.join(projectRoot, 'security_audit', 'coverage_matrix.json');
fs.writeFileSync(outputPath, JSON.stringify(coverageMatrix, null, 2), 'utf-8');
console.log(`Successfully generated coverage matrix at: ${outputPath}`);
console.log(`Total backend routes: ${allBackendRoutes.length}`);
console.log(`Covered routes: ${coveredRoutes.length} (${coverageMatrix.metadata.coverage_percentage}%)`);
console.log(`Uncovered routes: ${uncoveredRoutes.length}`);
