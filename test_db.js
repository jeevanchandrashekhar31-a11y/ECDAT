const { db } = require('./backend/src/db/connection');

async function run() {
  const callerTenant = "evaluation-tenant"; // evaluation-analyst
  const scanQuery = db("scans").where("tenant_id", callerTenant).orderBy("created_at", "desc");
  const scanRows = await scanQuery;
  const targetScanIds = scanRows.map(s => s.id);
  
  let assetQuery = db("assets").whereIn("scan_id", targetScanIds);
  if (!(targetScanIds.length === 1 && targetScanIds[0] === "demo-synthetic-scan")) {
    assetQuery = assetQuery.where("is_synthetic", false);
  }
  const assetRows = await assetQuery.limit(10);
  
  const liveAssetsCountRow = await db("assets").whereIn("scan_id", targetScanIds).count("id as count").first();
  const totalAssets = parseInt(liveAssetsCountRow?.count || 0, 10);
  
  console.log({
    scans: targetScanIds.length,
    totalAssets
  });
  process.exit(0);
}
run();
