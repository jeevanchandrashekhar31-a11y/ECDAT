const knex = require('knex')(require('./src/db/knexfile').development);

async function seed() {
  const scanId = "demo-synthetic-scan";
  
  // Insert an asset with mosca data
  await knex('assets').insert({
    id: "test-asset-blast-1",
    scan_id: scanId,
    asset_type: "application",
    primary_identifier: "Test App With Data",
    data_sensitivity: "internal",
    business_criticality: "high",
    highest_severity: "High",
    at_quantum_risk: true,
    metadata: JSON.stringify({
      mosca_x_years: 10,
      mosca_y_years: 5
    }),
    created_at: new Date(),
    updated_at: new Date()
  });

  console.log("Seeded test asset!");
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
