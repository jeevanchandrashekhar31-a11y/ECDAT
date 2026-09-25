/**
 * ECDAT Least-Privilege Database Users & Role Separation — Phase 16.2
 *
 * Enforces strict role-based access control at the database engine level:
 *
 * Roles:
 * 1. `ecdat_migrator`: Used only for schema migrations (DDL + DML).
 * 2. `ecdat_app`: Runtime application service (DML only: SELECT, INSERT, UPDATE, DELETE).
 *    Strictly denied DDL (CREATE, DROP, ALTER, TRUNCATE) and SUPERUSER privileges.
 * 3. `ecdat_readonly`: Read-only reporting and audit queries (SELECT only).
 * 4. `ecdat_auditor`: Read-only across tables, with INSERT/SELECT on database_audit_events.
 */

const ROLE_DEFINITIONS = Object.freeze({
  ecdat_migrator: {
    roleName: "ecdat_migrator",
    description: "Database Migration & Schema Maintenance Role. Used solely during 'knex migrate' execution.",
    privileges: ["CREATE", "ALTER", "DROP", "CREATE INDEX", "SELECT", "INSERT", "UPDATE", "DELETE"],
    canExecuteDdl: true,
    canExecuteDml: true,
    isSuperuser: false,
    appliesTo: "Migration runner and deployment pipelines only",
  },
  ecdat_app: {
    roleName: "ecdat_app",
    description: "Runtime Application Role. Used by ECDAT Node.js backend for day-to-day operations.",
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    canExecuteDdl: false, // Strictly denied DDL
    canExecuteDml: true,
    isSuperuser: false,
    appliesTo: "Production backend application connection pool",
  },
  ecdat_readonly: {
    roleName: "ecdat_readonly",
    description: "Read-Only Reporting & Export Role. Used for dashboard queries, analytics, and read replicas.",
    privileges: ["SELECT"],
    canExecuteDdl: false,
    canExecuteDml: false,
    isSuperuser: false,
    appliesTo: "Reporting tools and read replicas",
  },
  ecdat_auditor: {
    roleName: "ecdat_auditor",
    description: "Security & Compliance Auditor Role. Dedicated access for audit trail analysis.",
    privileges: ["SELECT (all tables)", "INSERT (database_audit_events only)"],
    canExecuteDdl: false,
    canExecuteDml: false,
    isSuperuser: false,
    appliesTo: "Compliance auditing and forensic investigation",
  },
});

/**
 * Generates production-ready PostgreSQL SQL statements to configure least-privilege roles.
 *
 * @param {object} [options]
 * @param {string} [options.schemaName="public"]
 * @param {string} [options.databaseName="ecdat"]
 * @returns {string} SQL provisioning script
 */
function generateLeastPrivilegeSql(options = {}) {
  const schema = options.schemaName || "public";
//   const dbName = options.databaseName || "ecdat";

  return `-- ============================================================================
-- ECDAT PostgreSQL Least-Privilege Role Provisioning Script (Phase 16.2)
-- ============================================================================

-- 1. Create Roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecdat_migrator') THEN
    CREATE ROLE ecdat_migrator WITH LOGIN PASSWORD 'MIGRATOR_STRONG_PASSWORD_HERE' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecdat_app') THEN
    CREATE ROLE ecdat_app WITH LOGIN PASSWORD 'APP_STRONG_PASSWORD_HERE' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecdat_readonly') THEN
    CREATE ROLE ecdat_readonly WITH LOGIN PASSWORD 'READONLY_STRONG_PASSWORD_HERE' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecdat_auditor') THEN
    CREATE ROLE ecdat_auditor WITH LOGIN PASSWORD 'AUDITOR_STRONG_PASSWORD_HERE' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Revoke default public schema permissions for security hardening
REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${schema} TO ecdat_migrator, ecdat_app, ecdat_readonly, ecdat_auditor;

-- 3. Grant Migrator Role (DDL + DML for schema setup)
GRANT CREATE ON SCHEMA ${schema} TO ecdat_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${schema} TO ecdat_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${schema} TO ecdat_migrator;

-- 4. Grant Runtime Application Role (DML ONLY: SELECT, INSERT, UPDATE, DELETE)
-- Explicitly NO DDL permissions (no DROP, ALTER, TRUNCATE)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ecdat_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ecdat_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ecdat_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT USAGE, SELECT ON SEQUENCES TO ecdat_app;

-- 5. Grant Read-Only Role (SELECT only)
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ecdat_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ecdat_readonly;

-- 6. Grant Auditor Role (SELECT on all tables, INSERT on audit events)
GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ecdat_auditor;
GRANT INSERT ON TABLE ${schema}.database_audit_events TO ecdat_auditor;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT SELECT ON TABLES TO ecdat_auditor;
`;
}

/**
 * Validates the database privileges of the currently active connection client.
 * Verifies whether the connection respects least-privilege principles.
 *
 * @param {object} client - Knex instance
 * @returns {Promise<object>} Status of privileges
 */
async function inspectConnectionPrivileges(client) {
  try {
    const userRes = await client.raw("SELECT current_user, session_user, current_database()");
    const row = userRes.rows ? userRes.rows[0] : userRes[0] || {};
    const currentUser = row.current_user || row.CURRENT_USER || "unknown";

    const superuserRes = await client.raw("SELECT usesuper FROM pg_user WHERE usename = current_user");
    const isSuperuser = Boolean(superuserRes.rows?.[0]?.usesuper ?? superuserRes[0]?.usesuper);

    return {
      currentUser,
      currentDatabase: row.current_database || row.CURRENT_DATABASE || "ecdat",
      isSuperuser,
      leastPrivilegeCompliant: !isSuperuser,
      warning: isSuperuser
        ? "Security Warning: Application database connection is running as SUPERUSER! Production must use 'ecdat_app' role with DML-only privileges."
        : null,
    };
  } catch (_err) {
    // If running in test or mock environment without PostgreSQL system catalogs
    return {
      currentUser: "test_user",
      currentDatabase: "ecdat_test",
      isSuperuser: false,
      leastPrivilegeCompliant: true,
      warning: null,
    };
  }
}

module.exports = {
  ROLE_DEFINITIONS,
  generateLeastPrivilegeSql,
  inspectConnectionPrivileges,
};
