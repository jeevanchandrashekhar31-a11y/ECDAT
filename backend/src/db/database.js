const { Pool } = require("pg");

// Setup Postgres connection pool
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:change-this-local-postgres-password@localhost:5432/ecdat", // ecdat:synthetic-fixture
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
