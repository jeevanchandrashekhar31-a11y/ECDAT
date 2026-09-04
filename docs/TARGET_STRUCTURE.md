# Target Directory Structure

To support scalability, separation of concerns, and team collaboration, the ECDAT repository will transition from a flat directory of scripts into a modular structure. 

## 1. Directory Structure

```text
/scanners
  /network
  /static
  /binary_container
/backend
  /api
  /risk_engine
  /db
/frontend
  /src
/rules
/docker
/docs
```

## 2. Directory Responsibilities and Expected Files

### `/scanners`
**Responsibility:** Houses all specialized tools for extracting cryptographic material and building CBOMs from various sources.
- `/scanners/network/`: Contains network scanning logic (using `sslyze`).
  - Expected Files: `main.py`, `tls_scanner.py`, `cert_parser.py`, `requirements.txt`.
- `/scanners/static/`: Contains regex/AST-based source code scanners.
  - Expected Files: `main.py`, `regex_rules.py`, `ast_parser.py`, `requirements.txt`.
- `/scanners/binary_container/`: Contains scanning tools for compiled binaries or container images (e.g., integrating with Syft).
  - Expected Files: `main.py`, `container_scanner.py`.

### `/backend`
**Responsibility:** The centralized control plane that orchestrates scans, ingests CBOMs, runs them through the risk engine, and stores the results.
- `/backend/api/`: REST/GraphQL endpoints for the frontend and scanners to interact with.
  - Expected Files: `main.py` (FastAPI/Flask entrypoint), `routes/`, `controllers/`, `schemas.py`.
- `/backend/risk_engine/`: The core logic for classifying findings and calculating Mosca's quantum gap.
  - Expected Files: `classifier.py`, `mosca_calculator.py`, `merger.py`.
- `/backend/db/`: Database models, migrations, and connection management.
  - Expected Files: `models.py`, `crud.py`, `database.py`, `alembic/` (migrations).

### `/frontend`
**Responsibility:** A Graphical User Interface for security engineers to visualize scan results and manage risk.
- `/frontend/src/`: The source code for the web application (e.g., React, Vue, Next.js).
  - Expected Files: `package.json`, `App.js`, `components/`, `pages/`, `services/api.js`.

### `/rules`
**Responsibility:** Externalized configuration and logic rules to avoid hardcoding inside the application.
- Expected Files: `mosca_params.json` (defining X, Y, Z defaults), `classification_rules.json` (defining what makes a finding Critical vs. Acceptable).

### `/docker`
**Responsibility:** Infrastructure-as-code and containerization definitions for standardizing deployment.
- Expected Files: `docker-compose.yml`, `backend.Dockerfile`, `frontend.Dockerfile`, `scanner.Dockerfile`.

### `/docs`
**Responsibility:** Project documentation, design specs, schemas, and API references.
- Expected Files: `README.md`, `ARCHITECTURE_GAP.md`, `REPO_INVENTORY.md`, `TARGET_STRUCTURE.md`, `ECDAT_CBOM_SCHEMA_CONTRACT.md`.

## 3. Module Boundaries & Communication

Clear boundaries ensure that components can scale and be maintained independently:

- **Scanners <-> Backend (HTTP API)**: 
  - *Current state*: Scanners write JSON files to disk, and the merge script reads them from disk.
  - *Target state*: Scanners will operate as standalone CLI tools or cron jobs that submit their generated CycloneDX CBOMs directly to the Backend API via HTTP POST requests (e.g., `POST /api/v1/scans/upload`).
  
- **Risk Engine <-> Backend API**:
  - The Risk Engine is a modular library within the Backend. 
  - When the API layer receives a CBOM payload, it passes the data structure to the Risk Engine (`classifier.py`). The Risk Engine dynamically loads external configuration from the `/rules/` directory and returns enriched, classified findings back to the API layer, which then persists the data via the DB module.

- **Frontend <-> Backend (HTTP API)**:
  - The Frontend is entirely decoupled from the Python business logic. It consumes data exclusively through the Backend's REST/GraphQL APIs (e.g., `GET /api/v1/dashboard/summary`, `GET /api/v1/assets`). 
  - This separation ensures the UI remains stateless, easily deployable via CDNs, and technology-agnostic.
