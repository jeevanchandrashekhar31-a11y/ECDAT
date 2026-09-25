const { db } = require('./backend/src/db/connection');

async function run() {
  const callerTenant = "evaluation-tenant";
  const scanId = "demo-synthetic-scan";
  let targetScanId = scanId;
  
  let query = db("findings")
    .join("scans", "findings.scan_id", "scans.id")
    .where("scans.tenant_id", callerTenant);
    
  if (targetScanId) {
    query = query.where("findings.scan_id", targetScanId);
  }
  
  const countQuery = query.clone().count("findings.id as count").first();
  const res = await countQuery;
  console.log(res);
  process.exit(0);
}
run();
