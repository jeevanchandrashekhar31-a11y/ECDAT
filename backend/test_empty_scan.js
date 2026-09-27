require('dotenv').config({ path: './.env' });
const { db, isDbConnected } = require('./src/db/connection');
const http = require('http');

const scanId = 'empty-scan-truthfulness-test-' + Date.now();

function apiReq(path, tok) {
  return new Promise((resolve) => {
    const hdrs = { 'Authorization': 'Bearer ' + tok };
    const r = http.request({ hostname:'localhost', port:5000, path, method:'GET', headers:hdrs }, (res) => {
      let d = ''; res.on('data', c => d+=c); res.on('end', () => resolve({status:res.statusCode, body:d}));
    });
    r.on('error', e => resolve({status:0, body:e.message}));
    r.setTimeout(8000, () => { r.destroy(); resolve({status:0,body:'TIMEOUT'}); });
    r.end();
  });
}
function apiPost(path, body) {
  return new Promise((resolve) => {
    const bd = JSON.stringify(body);
    const r = http.request({ hostname:'localhost', port:5000, path, method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bd)} }, (res) => {
      let d = ''; res.on('data', c => d+=c); res.on('end', () => resolve({status:res.statusCode, body:d}));
    });
    r.on('error', e => resolve({status:0, body:e.message}));
    r.setTimeout(8000, () => { r.destroy(); resolve({status:0,body:'TIMEOUT'}); });
    r.write(bd); r.end();
  });
}

async function main() {
  console.log('DB connected:', isDbConnected());

  // Insert empty scan directly into Neon
  try {
    await db('scans').insert({
      id: scanId,
      tenant_id: 'evaluation-tenant',
      target_name: 'Empty Truthfulness Test',
      scanner_type: 'static',
      status: 'completed',
      policy_profile_id: 'ecdat_enterprise_baseline',
      deployment_context: 'internet_facing',
      threat_horizon: 'baseline_2033',
      total_assets: 0, total_findings: 0,
      quantum_risk_count: 0, critical_count: 0,
      high_count: 0, medium_count: 0, low_count: 0, info_count: 0,
      created_at: new Date().toISOString()
    });
    console.log('INSERTED EMPTY SCAN ID:', scanId);
  } catch(e) {
    console.error('INSERT FAILED:', e.message);
    await db.destroy(); process.exit(1);
  }

  // Get eval token
  const lr = await apiPost('/api/v1/auth/evaluation/enter', {});
  const tok = JSON.parse(lr.body).accessToken;

  // Check dashboard shows 0 for this scan
  const dash = await apiReq(`/api/v1/dashboard/summary?scanId=${scanId}`, tok);
  const dashData = JSON.parse(dash.body);
  console.log('DASHBOARD for empty scan:');
  console.log('  total_assets:', dashData.metrics?.total_assets);
  console.log('  total_findings:', dashData.metrics?.total_findings);
  console.log('  assets_at_quantum_risk:', dashData.metrics?.assets_at_quantum_risk);
  const fabricated = dashData.metrics?.total_assets > 0 || dashData.metrics?.total_findings > 0;
  console.log('TRUTHFULNESS CHECK:', fabricated ? 'FABRICATED DATA DETECTED' : 'PASS — zero everywhere');

  // Check reports/summary
  const rep = await apiReq(`/api/v1/reports/summary?scanId=${scanId}`, tok);
  const repData = JSON.parse(rep.body);
  console.log('REPORTS/SUMMARY for empty scan:');
  console.log('  metrics:', JSON.stringify(repData.metrics));
  console.log('  top_risky_assets count:', (repData.top_risky_assets || []).length);

  // Cleanup
  await db('scans').where({ id: scanId }).delete();
  console.log('Cleaned up test scan from Neon');
  await db.destroy();
}

main().catch(e => { console.error('SCRIPT ERROR:', e.message); process.exit(1); });
