# Testing and quality gates

Normal test commands are deterministic and do not call external endpoints. TLS,
Syft, and Groq clients are replaced with mocks in their unit tests. Network
scanning and optional LLM verification are not part of the normal test suite.

## Install development dependencies

```bash
python -m pip install -r requirements.txt
npm ci --prefix backend
npm ci --prefix frontend
```

## Python scanner tests

```bash
python -m pytest
python -m pytest --cov=scanners --cov-report=term-missing
python -m ruff check scanners tests
python -m ruff format --check scanners tests
```

Test coverage includes static scanner integration against committed fixtures,
CBOM mapping/validation, secret and LLM privacy filtering, and mocked Syft,
Groq HTTP, and SSLyze scanner behavior.

## Backend tests

```bash
npm test --prefix backend
npm run test:coverage --prefix backend
npm run lint --prefix backend
npm run format:check --prefix backend
```

The Node test suite contains risk-engine unit tests, CBOM/security validation,
API authentication/upload/query tests, and database persistence coverage. It
uses the configured test/local database; PostgreSQL unavailability falls back
to the in-memory ingestion store where supported. Run the Compose stack when
you need to exercise migrations and a real PostgreSQL service together.

## Frontend tests

```bash
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run lint --prefix frontend
npm run format:check --prefix frontend
npm run build --prefix frontend
```

Vitest runs in JSDOM. Component tests cover Mosca calculations, simulations,
and reset behavior. Dashboard smoke tests mock the API client and cover both
successful and unavailable states without a backend or network request.

## CI quality gate

`.github/workflows/ecdat-scan.yml` installs dependencies, runs the Python
coverage suite and scanner static checks, backend lint/coverage suite, frontend
lint/type/component tests/build, then uploads CBOM/SARIF/summary artifacts.

Before a release, also run the dependency-audit commands documented in
`docs/SECURITY_REVIEW.md`.
