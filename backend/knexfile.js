const path = require('path');
const config = require('./src/config');
const { configureDbTls } = require('./src/security/transit_security');

function buildConnection(env) {
  try {
    const ssl = configureDbTls({
      nodeEnv: env,
      sslEnabled: config.DATABASE_SSL,
      rejectUnauthorized: config.DATABASE_SSL_REJECT_UNAUTHORIZED,
      caCertPath: config.DATABASE_SSL_CA_PATH,
    });
    if (ssl) {
      return {
        connectionString: config.DATABASE_URL,
        ssl,
      };
    }
  } catch (_err) {
    // In dev/test fallback to raw connection if SSL fails configuration
  }
  return config.DATABASE_URL;
}

module.exports = {
  development: {
    client: 'pg',
    connection: buildConnection('development'),
    acquireConnectionTimeout: 10000,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000
    }
  },
  test: {
    client: 'pg',
    connection: buildConnection('test'),
    acquireConnectionTimeout: 10000,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 0,
      max: 5,
      idleTimeoutMillis: 1000
    }
  },
  production: {
    client: 'pg',
    connection: buildConnection('production'),
    acquireConnectionTimeout: 10000,
    migrations: {
      directory: path.join(__dirname, 'src/db/migrations'),
      tableName: 'knex_migrations'
    },
    pool: {
      min: 2,
      max: 20,
      idleTimeoutMillis: 30000
    }
  }
};

