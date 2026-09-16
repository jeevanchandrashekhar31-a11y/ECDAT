const fs = require("fs");
const path = require("path");
const { db } = require("./connection");
const config = require("../config");

async function seedDefaults() {
  console.log(
    "Seeding default policy profiles and rule versions into PostgreSQL...",
  );

  // 1. Seed Policy Profiles
  const policyProfilesPath = path.join(
    config.RULES_DIR,
    "policy_profiles.json",
  );
  if (fs.existsSync(policyProfilesPath)) {
    const data = JSON.parse(fs.readFileSync(policyProfilesPath, "utf-8"));
    const profiles = data.profiles || {};

    for (const [id, prof] of Object.entries(profiles)) {
      await db("policy_profiles")
        .insert({
          id,
          name: prof.name,
          description: prof.description,
          min_rsa_bits: prof.key_size_policy?.min_rsa_bits || 2048,
          min_ecc_bits: prof.key_size_policy?.min_ecc_bits || 256,
          allow_self_signed:
            prof.certificate_policy?.allow_self_signed || false,
          cicd_fail_threshold: prof.cicd_fail_threshold || "high",
          config: JSON.stringify(prof),
        })
        .onConflict("id")
        .merge();
    }
    console.log(`✓ Seeded ${Object.keys(profiles).length} policy profiles.`);
  }

  // 2. Seed Rule Versions
  const ruleFiles = [
    { type: "algorithm_risk", file: "algorithm_risk.json" },
    { type: "mosca_config", file: "mosca_config.json" },
    { type: "policy_profiles", file: "policy_profiles.json" },
    { type: "pqc_recommendations", file: "pqc_recommendations.json" },
    { type: "crypto_library_catalog", file: "crypto_library_catalog.json" },
    { type: "policy_as_code", file: "policy_as_code.json" },
  ];

  for (const rf of ruleFiles) {
    const fPath = path.join(config.RULES_DIR, rf.file);
    if (fs.existsSync(fPath)) {
      const content = JSON.parse(fs.readFileSync(fPath, "utf-8"));
      const version = content.version || "1.0.0";

      await db("rule_versions")
        .insert({
          version,
          ruleset_type: rf.type,
          content: JSON.stringify(content),
        })
        .onConflict(["version", "ruleset_type"])
        .merge();
    }
  }
  console.log(`✓ Seeded ${ruleFiles.length} rule versions.`);
}

if (require.main === module) {
  seedDefaults()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}

module.exports = { seedDefaults };
