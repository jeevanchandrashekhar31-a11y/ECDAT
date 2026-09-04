const path = require('path');
const config = require('./src/config');

module.exports = {
  development: {
    client: 'pg',
    connection: config.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 2,
      max: 10
    }
  },
  test: {
    client: 'pg',
    connection: config.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 1,
      max: 5
    }
  },
  production: {
    client: 'pg',
    connection: config.DATABASE_URL,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 2,
      max: 20
    }
  }
};
