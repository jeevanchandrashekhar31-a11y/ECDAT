const { Pool } = require("pg");

// Setup Postgres connection pool
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/ecdat",
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
