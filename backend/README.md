# ECDAT Backend & Risk Engine API

The ECDAT backend is an enterprise-grade Express and Node.js service providing CycloneDX 1.6 Cryptographic Bill of Materials (CBOM) ingestion, deterministic rule-based risk classification, Mosca quantum timeline modeling ($X + Y > Z$), context-aware PQC/hybrid migration recommendations, and executive reporting.

## Features

- **CycloneDX 1.6 Compliant**: Safely ingests and annotates CBOM documents with `ecdat:risk:*` metadata properties without violating specifications or mutating core scanner evidence.
- **Explainable Mosca Theorem Engine**: Visible $X$ (data shelf-life), $Y$ (migration duration), and $Z$ (CRQC horizon) calculations per asset.
- **Configurable Environmental Policy Profiles**: Evaluates environments against distinct compliance profiles (`public_internet`, `internal_enterprise`, `regulated_bfsi`, `government_high_value`, `iot_ot`).
- **RESTful API v1**: Clean endpoints for CBOM ingestion, findings querying, asset aggregation, dashboard statistics, and reports.
- **Reporting Engine**: Emits both frontend JSON summaries and self-contained static HTML reports.
- **Enterprise Security**: Helmet security headers, strict origin-checked CORS, request ID propagation (`X-Request-Id`), structured logs with secret redaction, and bounded JSON payloads (up to 50MB).

## Architecture

```text
backend/
├── src/
│   ├── app.js               # Express application initialization & router mounting
│   ├── server.js            # Server entrypoint with startup ruleset validation
│   ├── config.js            # Environment configuration loader
│   ├── middleware/
│   │   ├── security.js      # Helmet, CORS, and secret-redacting logger
│   │   ├── request_id.js    # Request ID generator & header propagator
│   │   └── error_handler.js # Centralized error & 404 handler (no prod stack traces)
│   ├── routes/
│   │   ├── health.js        # GET /health
│   │   ├── cbom.js          # POST /api/v1/cbom/ingest, GET /api/v1/cbom/:id
│   │   ├── findings.js      # GET /api/v1/findings
│   │   ├── assets.js        # GET /api/v1/assets, GET /api/v1/assets/:id
│   │   ├── dashboard.js     # GET /api/v1/dashboard/summary
│   │   └── reports.js       # GET /api/v1/reports/:id/html, summary
│   ├── services/
│   │   ├── cbom_validation.js # Structural validation for CycloneDX 1.6
│   │   ├── cbom_ingestion.js  # Ingestion & risk annotation orchestration
│   │   └── scan_import.js     # File-based and raw payload imports
│   └── risk_engine/         # Core deterministic risk calculus & Mosca engine
└── tests/                   # Automated unit & integration tests
```

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Development Server
```bash
npm start
```

API Server runs at `http://localhost:5000` with the health endpoint available at `http://localhost:5000/health`.
