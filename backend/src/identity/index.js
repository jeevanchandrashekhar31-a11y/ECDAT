/**
 * Identity and Directory Integration Subsystem — Phase 14.2
 */

const { AuthAuditLogger, defaultAuthAuditLogger, AUTH_EVENT_TYPES } = require("./auth_audit");
const { SecretManager, defaultSecretManager } = require("./secret_manager");
const {
  TokenService,
  defaultTokenService,
  DEFAULT_ACCESS_TOKEN_TTL_SEC,
  MAX_ACCESS_TOKEN_TTL_SEC,
} = require("./token_service");
const { OidcHandler, DEFAULT_ROLE_MAPPING } = require("./oidc_provider");
const { LdapClient, DEFAULT_LDAP_ROLE_MAPPING } = require("./ldap_client");
const {
  PasswordPolicy,
  PasswordPolicyError,
  AccountLockedError,
  LocalAuthManager,
  defaultLocalAuthManager,
  EXTENDED_AUTH_EVENT_TYPES,
  COMMON_PASSWORDS_BLACKLIST,
} = require("./password_auth");
const {
  MfaTotpEngine,
  defaultMfaEngine,
  base32Encode,
  base32Decode,
} = require("./mfa_totp");

module.exports = {
  AuthAuditLogger,
  defaultAuthAuditLogger,
  AUTH_EVENT_TYPES,
  EXTENDED_AUTH_EVENT_TYPES,
  SecretManager,
  defaultSecretManager,
  TokenService,
  defaultTokenService,
  DEFAULT_ACCESS_TOKEN_TTL_SEC,
  MAX_ACCESS_TOKEN_TTL_SEC,
  OidcHandler,
  DEFAULT_ROLE_MAPPING,
  LdapClient,
  DEFAULT_LDAP_ROLE_MAPPING,
  PasswordPolicy,
  PasswordPolicyError,
  AccountLockedError,
  LocalAuthManager,
  defaultLocalAuthManager,
  COMMON_PASSWORDS_BLACKLIST,
  MfaTotpEngine,
  defaultMfaEngine,
  base32Encode,
  base32Decode,
};
