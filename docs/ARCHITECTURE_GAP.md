# Architecture Gap Analysis

This document maps the current state of the ECDAT repository against the target architecture defined in the research and technical decisions documentation. It highlights misalignments and prioritizes gaps for refactoring and feature development.

## 1. Architecture Summaries

### Target Architecture
- **Scanners**: Robust, library-driven scanners (e.g., utilizing `sslyze` for comprehensive network TLS scans) that uniformly output standard CycloneDX 1.6 CBOMs using the `cyclonedx-python-lib`.
- **Backend**: A centralized API service (e.g., FastAPI/Django) responsible for orchestrating scans, managing risk analysis, and exposing endpoints.
- **Database (DB)**: Persistent storage (e.g., PostgreSQL, MongoDB) for historical scan data, merged CBOMs, and cryptographic asset tracking over time.
- **Frontend**: An interactive Graphical User Interface (GUI) to visualize cryptographic posture, quantum-readiness risks (Mosca's gap), and remediation workflows.
- **Rules**: Externalized, configurable JSON rulesets governing classification criteria and Mosca's theorem parameters (X, Y, Z).
- **Deployment**: Standardized and containerized deployment (e.g., Docker, Kubernetes) with CI/CD integration.

### Current Architecture
- Consists of **3 independent Python scripts** (`ecdat_network_scanner.py`, `static_scanner.py`, `merge_and_classify.py`).
- **No Backend, DB, or GUI** (relies entirely on manual CLI execution, local flat-file JSON I/O, and simple static HTML generation).

---

## 2. Component Mapping & Gaps

### Scanners
- **Current State**: 
  - `static_scanner.py` partially meets the target by using regex and `cyclonedx-python-lib` for CBOM generation.
  - `ecdat_network_scanner.py` utilizes a custom raw TCP/TLS socket handshake instead of comprehensive libraries. It also manually constructs CBOM JSON dictionaries instead of using the official CycloneDX library.
- **Partially Implemented**: Static code scanning CBOM generation.
- **Completely Missing**: `sslyze` integration for network scanning; standardized CBOM object models in the network scanner.
- **Misalignments**:
  - Custom TLS handshake vs. required `sslyze`.
  - Manual CBOM JSON construction vs. `cyclonedx-python-lib`.

### Rules Engine
- **Current State**: `merge_and_classify.py` hardcodes Mosca's theorem parameters (`MOSCA_Y = 3`, `MOSCA_Z = 10`) and inline if/else classification logic (e.g., MD5 is Critical).
- **Partially Implemented**: The math for Mosca's theorem and basic classification routing exists.
- **Completely Missing**: External configuration.
- **Misalignments**:
  - Hardcoded Mosca params vs. external JSON ruleset.

### Backend Service
- **Current State**: None. The merge script acts as a one-off processing job.
- **Partially Implemented**: N/A
- **Completely Missing**: The entire API layer and orchestration logic.

### Database (DB)
- **Current State**: None. Output is saved to local files (e.g., `merged_cbom.json`).
- **Partially Implemented**: N/A
- **Completely Missing**: Persistent storage schemas, database provisioning, and ORM integration.

### Frontend (GUI)
- **Current State**: None. `merge_and_classify.py` generates a static `summary.html` file.
- **Partially Implemented**: Basic HTML layout generation.
- **Completely Missing**: Interactive dashboard, dynamic data fetching, UI frameworks.

### Deployment
- **Current State**: Manual execution via bash.
- **Partially Implemented**: N/A
- **Completely Missing**: Dockerfiles, orchestrator configs, and CI/CD pipelines.

---

## 3. Prioritized Action Plan

### P0 (Must-have for SIH Deliverable)
- **Scanner Alignment**: Refactor `ecdat_network_scanner.py` to use `sslyze` for TLS handshakes and cipher suite enumeration.
- **CBOM Standardization**: Refactor `ecdat_network_scanner.py` and `merge_and_classify.py` to use `cyclonedx-python-lib` instead of manual JSON dictionary generation.
- **Rules Externalization**: Extract hardcoded Mosca parameters (X, Y, Z) and classification logic from `merge_and_classify.py` into a configurable JSON ruleset.
- **Backend MVP**: Implement a basic API backend to orchestrate the scanners and serve the merged JSON.

### P1 (Important for best-in-class positioning)
- **Frontend GUI**: Replace the static `summary.html` generation with a dedicated interactive web dashboard (e.g., React/Vue/Next.js) that consumes the backend API.
- **Database Integration**: Introduce a DB (e.g., PostgreSQL or SQLite for MVP) to persist CBOMs, track historical changes, and manage rulesets.
- **Deployment**: Dockerize the scanners, backend, and frontend for reproducible 1-click deployments.

### P2 (Nice-to-have)
- **CI/CD Integration**: Add GitHub Actions/GitLab CI pipelines to run scanners automatically against source code on push.
- **Advanced Cipher Coverage**: Expand `sslyze` parsing to include legacy fallback ciphers not just the single negotiated one.
