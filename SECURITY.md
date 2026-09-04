# Security policy

## Supported deployment posture

ECDAT is a prototype. Do not expose it publicly with the development defaults.
For production, set a strong `ECDAT_API_KEY`, explicit `CORS_ORIGIN` values,
`REQUIRE_AUTH_FOR_READS=true` where appropriate, TLS at the reverse proxy, and
network egress restrictions for scanner workers.

## Reporting a vulnerability

Do not open a public issue with exploit details, credentials, CBOMs, or private
keys. Report privately to the repository owner with a minimal reproduction,
affected version/commit, impact, and suggested remediation. Expect an initial
acknowledgement within five business days.

## Secure development checks

Before release, run the dependency checks in `docs/SECURITY_REVIEW.md`, scan
staged changes with a secret scanner, run both test suites, and confirm that no
`.env`, reports, artifacts, or key material are included in the change.

See `docs/THREAT_MODEL.md` for boundaries and known limitations.
