# ECDAT threat model

## Scope and trust boundaries

ECDAT accepts untrusted CBOM JSON, local paths/images selected by an operator,
and network targets selected by an operator. It then stores CBOM-derived data,
returns it through an API, and renders it in a React UI and static report. The
optional LLM provider is an external trust boundary.

| Threat | Primary mitigation | Residual risk |
| --- | --- | --- |
| Path traversal or symlink escape | Static discovery resolves a canonical root and skips symlinks/outside paths. | The CLI operator can intentionally scan any accessible root. |
| Shell/command injection | Syft uses an argument list with `shell=False`; image targets have a strict format. | Syft itself remains a trusted third-party executable. |
| Resource exhaustion | File/count, output, HTTP-body, component, depth, multipart, timeout, and concurrency limits. | A valid 10 MB CBOM can still require meaningful CPU to classify. |
| SSRF/internal discovery | Public targets only by default, all resolved DNS addresses validated, selected IP pinned. | Approved `--allow-private-targets` defeats this guard by design. |
| DNS rebinding | Validate all answers; pass the resolved IP to scanners rather than resolve again. | Network routing/egress policy remains an infrastructure responsibility. |
| Secret disclosure | Scanner/LLM/report redaction, no raw source reports, header-only auth, generic internal errors. | Pattern redaction can miss novel secret formats. |
| API abuse | Write authentication, rate limit, body limits, safe request IDs, CORS allowlist. | Single shared API key and process-local limiter are prototype constraints. |
| Stored/reflected XSS | CBOM validation, React text rendering, escaped/sanitized static HTML, report iframe without scripts. | New UI code must preserve the no-unsafe-HTML rule. |
| SQL injection or partial writes | Knex parameterized query APIs and transactions. | Raw SQL additions require review; database access controls are deployment-specific. |
| XML Entity Injection / XXE | Pre-parse rejection of DOCTYPE/ENTITY declarations and payload size limits. | Malicious XML bombs are rejected before DOM parsing. |
| Prototype Pollution | Object prototype freeze protection and explicit rejection of __proto__ / constructor keys. | Untrusted JSON cannot mutate JavaScript runtime prototypes. |
| Private Key / Secret Leakage in Errors | CANARY_TOKEN_REGEX and multi-token secret redaction across all crash traces and exceptions. | Zero canary tokens or raw private keys in diagnostic outputs. |

## Security invariants

- No scanner invokes a shell; CI verifies no `shell=True` use.
- Private-key material is redacted before persistence and report generation.
- LLM calls require an explicit opt-in and send only sanitized snippets.
- Production startup requires an API key and explicit CORS origins.
- User-controlled asset/component strings are rendered as text, never injected
  as HTML in the frontend.
- **Regression Policy Invariant (Phase 22.4)**: Every previously fixed security
  vulnerability gets a permanent automated regression test. Never close a security
  bug without: (1) root cause, (2) fix, (3) test, (4) threat model update, (5) release note.

