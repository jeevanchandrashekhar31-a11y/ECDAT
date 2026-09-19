#!/usr/bin/env node

const http = require('http');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = require('../config');
const { clearScans } = require('../services/cbom_ingestion');
const { closeDb } = require('../db/connection');

async function main() {
  if (!config.ECDAT_API_KEY) {
    console.error('Error: ECDAT_API_KEY is not set.');
    process.exit(1);
  }

  // 1. Try to clear via running server HTTP endpoint first (so server RAM is cleared)
  const clearedViaHttp = await new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: config.PORT || 5000,
        path: '/api/v1/scans',
        method: 'DELETE',
        headers: {
          'X-API-Key': config.ECDAT_API_KEY,
        },
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('✓ Successfully reset running server state and database to zero via API.');
            resolve(true);
          } else {
            resolve(false);
          }
        });
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });

  // 2. If server was not running, clear directly against PostgreSQL
  if (!clearedViaHttp) {
    try {
      await clearScans();
      console.log('✓ Successfully reset database tables to zero directly.');
    } catch (err) {
      console.error('Failed to clear database directly:', err.message);
    } finally {
      await closeDb().catch(() => {});
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Error clearing data:', err.message);
  process.exit(1);
});
