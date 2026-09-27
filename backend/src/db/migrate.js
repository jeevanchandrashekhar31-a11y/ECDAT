/**
 * ECDAT Database Migration Runner
 * Runs all Knex migrations in order against the configured DATABASE_URL.
 * Called automatically by Render on every deploy via: npm run migrate
 *
 * Usage:
 *   node src/db/migrate.js
 *   OR via npm: npm run migrate
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });

const knex = require('knex');
const knexConfig = require('../../knexfile');

const env = process.env.NODE_ENV || 'production';
const config = knexConfig[env] || knexConfig.production;

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Cannot run migrations.');
  console.error('   Set it via: export DATABASE_URL=postgresql://...');
  process.exit(1);
}

console.log(`\n🔧 ECDAT Migration Runner`);
console.log(`   Environment : ${env}`);
console.log(`   Database    : ${process.env.DATABASE_URL.replace(/:[^@]+@/, ':***@')}`);
console.log(`   Migrations  : ${__dirname}\n`);

const db = knex(config);

(async () => {
  try {
    // Check connection first
    await db.raw('SELECT 1');
    console.log('✅ Database connection verified\n');

    // Run all pending migrations
    const [batchNo, migrations] = await db.migrate.latest({
      directory: require('path').resolve(__dirname, 'migrations'),
      tableName:  'knex_migrations',
    });

    if (migrations.length === 0) {
      console.log('✅ All migrations already up to date — nothing to run.\n');
    } else {
      console.log(`✅ Batch ${batchNo} — ${migrations.length} migration(s) applied:`);
      migrations.forEach(m => console.log(`   → ${m}`));
      console.log('');
    }

    process.exit(0);
  } catch (err) {
    console.error('\n❌ Migration failed:');
    console.error(`   ${err.message}`);
    if (err.code === 'ECONNREFUSED') {
      console.error('   Is the database running and DATABASE_URL correct?');
    }
    process.exit(1);
  } finally {
    await db.destroy().catch(() => {});
  }
})();
