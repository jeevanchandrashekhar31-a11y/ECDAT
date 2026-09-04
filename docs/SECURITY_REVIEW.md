# Security review — Phase 8.2

Reviewed: 2026-09-05. This review covers the shipped prototype, not a formal
penetration test or compliance certification.

## Implemented controls

| Area | Controls verified or added |
| --- | --- |
| Static scanner | Canonical-root checks, symlink rejection, extension allowlist, 100 MB per-file maximum, 10,000-file maximum, bounded output, and secret-redacted SARIF evidence. |
| Binary/container scanner | `subprocess.run` uses argument arrays and `shell=False`; targets are validated; image names are constrained; Syft has a 1–600 second timeout and a 100 MB output cap. Diagnostic command/stderr content is not logged. |
| Network scanner | Validates ports and targets, rejects URL credentials, blocks loopback/private/link-local/multicast/reserved destinations by default, validates every DNS answer, and connects using the previously resolved IP. SSH packet length is capped; concurrency is 1–20 and SSH timeouts are 1–60 seconds. |
| LLM verification | Off unless explicitly selected; sends a bounded local snippet rather than a file; rejects PEM-bearing files; redacts likely secrets; caps requests at 20 and timeouts at 30 seconds; retains static findings when verification fails; CBOM findings retain their analysis-source label. |
| Backend | Header-based constant-time API-key checks for writes, explicit-origin CORS, Helmet CSP/referrer policy, 10 MB default JSON/upload bounds, structural CBOM validation, private-key redaction, dangerous-key rejection, bounded nesting/components, transactional persistence, sanitized 500 responses, and upload rate limiting. |
| Frontend | React’s default escaped rendering is used for CBOM-derived values; no `dangerouslySetInnerHTML` is present. Uploaded files/text are size-checked, routes encode scan IDs, and report iframes do not permit scripts. |

## Findings and disposition

- The old `backend/src/api/server.js` could create a permissive application. It
  now delegates to the hardened application entry point.
- API keys in query strings were accepted. They are no longer accepted, avoiding
  URL/history/proxy leakage.
- Unhandled backend errors formerly disclosed message/stack outside production.
  They now return a generic response with a request ID.
- Uploaded CBOMs are bounded at the HTTP layer and again during service
  validation. Oversized payloads receive HTTP 413.

## Remaining limitations

- The API key is a single shared secret, not an identity/role system. Production
  requires `ECDAT_API_KEY`; replace it with managed, rotated per-user/service
  credentials before an internet-facing deployment.
- The in-memory rate limiter is process-local. Deploy a shared limiter (for
  example at an API gateway or Redis) before running multiple instances.
- `--allow-private-targets` deliberately enables internal scanning. Use it only
  in an approved, isolated environment. TLS timeout behavior is controlled by
  SSLyze; application-level cancellation is not yet exposed by its wrapper.
- DNS answers are checked and the selected address is pinned for one scan, but
  continuous scanning needs egress firewall controls as defense in depth.
- Redaction is pattern-based. Treat reports as sensitive operational data and
  do not rely on redaction as a data-loss-prevention system.
- Static findings are not proof of exploitability; LLM verification is optional
  and must not be treated as an authoritative security decision.

## Dependency and secret hygiene

Run these before release and remediate or document findings:

```bash
npm audit --prefix backend
npm audit --prefix frontend
python -m pip install pip-audit
pip-audit -r requirements.txt
```

`.gitignore` excludes `.env*`, scan artifacts, reports, SARIF, and common key
formats. Add a pre-commit secret scanner such as Gitleaks or detect-secrets;
block commits that contain credentials, private keys, or production reports.
