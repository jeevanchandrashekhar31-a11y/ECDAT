#!/usr/bin/env node

const { isDbConnected, runMigrations, closeDb } = require("../db/connection");
const { seedDefaults } = require("../db/seed_defaults");

const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 2000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function prepareDatabase() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (await isDbConnected()) {
      await runMigrations();
      await seedDefaults();
      await closeDb();
      console.log("Database is ready.");
      return;
    }
    console.log(`Waiting for PostgreSQL (${attempt}/${MAX_ATTEMPTS})...`);
    await wait(RETRY_DELAY_MS);
  }
  await closeDb();
  throw new Error(
    "PostgreSQL did not become ready before the startup timeout.",
  );
}

prepareDatabase().catch((error) => {
  console.error(`Database preparation failed: ${error.message}`);
  process.exitCode = 1;
});
