# Local Docker deployment

## Prerequisites

Install Docker Desktop (or Docker Engine with the Compose plugin). No local
Node, Python, PostgreSQL, API key, or database setup is required.

## Start the demo

From the repository root:

```bash
cp docker/.env.example .env
docker compose up --build
```

On PowerShell, use `Copy-Item docker/.env.example .env`. The example values are
strictly for a local demo; replace both passwords before sharing an environment.
The `.env` file is ignored by Git and is never copied into an image.

Open http://localhost:8080. The `demo-seed` one-shot container automatically
imports a deliberately weak, non-sensitive demo CBOM after the backend becomes
healthy. It exits successfully once the import completes.

## Services and health

`docker compose ps` shows health for PostgreSQL, backend, and frontend.

You can also check the backend dependency-aware health endpoint:

```bash
curl http://localhost:5000/health
```

It reports `healthy` only when the backend can reach PostgreSQL in the Compose
deployment.

| Service | Local address | Notes |
| --- | --- | --- |
| Frontend | http://localhost:8080 | Public UI and same-origin API proxy |
| Backend | http://localhost:5000/health | Bound to loopback for local API work |
| PostgreSQL | not published | Accessible only on the internal `data` Docker network |

The backend has both a Compose dependency health condition and an active
database retry/migrate/seed step. It does not start the HTTP server until it
can connect to PostgreSQL, run migrations, and seed policy/rule defaults.

## Stop and reset

```bash
docker compose down
```

This preserves the named `postgres_data` volume. To intentionally erase local
demo data, run `docker compose down -v`.

## Optional scanner utility

Run a static scan over the checked-out repository (mounted read-only):

```bash
docker compose --profile tools run --rm scanner
```

Its CBOM is written under `artifacts/docker_static_cbom.json` on the host.
The scanner service has no network access or published ports. Do not mount sensitive paths into
it unless they are in the approved scan scope.

## Configuration

`docker/.env.example` documents the Compose variables. Only frontend and
backend ports are published, and both bind to `127.0.0.1` by default. Keep
PostgreSQL on the internal network. For a remotely accessible deployment, use
a TLS-terminating reverse proxy, unique managed secrets, strict CORS origins,
and `REQUIRE_AUTH_FOR_READS=true`.

## Troubleshooting

- If `docker compose up --build` cannot connect to the Docker API, start Docker
  Desktop (or the Docker daemon) and retry.
- If the selected port is busy, change `FRONTEND_PORT` or `BACKEND_PORT` in
  `.env`, then restart the stack.
- If `demo-seed` exits unsuccessfully, inspect `docker compose logs demo-seed`
  and `docker compose logs backend`; database migrations complete before the
  backend health check can pass.
