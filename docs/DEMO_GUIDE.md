# ECDAT Demo Walkthrough Guide (5–8 Minute Judge Presentation)

This guide documents the exact, working demonstration path implemented in ECDAT. It follows the verified flow:
**Enter Demo → Dashboard → Start Scan → Findings → CBOM View → PQC Assessment → Remediation → Verification**.

---

## Preparation & Prerequisites (0:00 – 1:00)

1. **Start the Backend in Demo Mode**:
   ```bash
   cd backend
   AUTH_MODE=demo npm start
   ```
   *The backend starts on port 5000 with pre-configured demo tenant data and bypassed credential barriers.*

2. **Start the Frontend Development Server**:
   ```bash
   cd frontend
   npm run dev
   ```
   *The frontend starts at `http://localhost:5173`.*

3. Open `http://localhost:5173` in your browser.

---

## Step 1: Enter Demo Mode (1:00 – 1:30)

- **Target Route**: `/login`
- **Action**: Click the **"Enter Demo Mode"** button below the standard login form.
- **What to Explain**:
  - ECDAT supports an explicit Demo Mode designed for live evaluation.
  - Clicking this button bypasses manual credential entry and immediately provisions an authenticated session scoped to the demo tenant with analytical privileges.
  - The UI transitions directly to the main navigation and redirects to `/dashboard`.

---

## Step 2: Dashboard Overview (1:30 – 2:30)

- **Target Route**: `/dashboard`
- **What to Show**:
  - **Zero-State Transparency**: If no scans have been performed, the dashboard displays honest zero/unassessed values rather than synthetic or fabricated placeholders.
  - **Asset & Inventory Metrics**: Once scanned, cards summarize Total Discovered Assets, Active Algorithms, Key Length distribution, and Certificates.
  - **Risk Summary**: Breakdown of findings across severity levels (Critical, High, Medium, Low, Informational).
  - **Quantum Vulnerability Metric**: Mosca's Theorem indicator showing the number of cryptographic assets vulnerable to quantum cryptanalysis ($X + Y > Z$).

---

## Step 3: Trigger a Cryptographic Scan (2:30 – 3:30)

- **Target Route**: `/scans` (or scan trigger panel on `/dashboard`)
- **Action**:
  - Select the target workspace or repository directory (e.g., `.` or a sample code directory).
  - Select the Policy Profile: `regulated_bfsi` (or default standard).
  - Click **"Start Scan"**.
- **What to Explain**:
  - Scans run deterministically via the static analysis engine.
  - The engine uses Abstract Syntax Tree (AST) pattern matching and regex heuristics across multiple languages (Python, JavaScript/TypeScript, Go, C/C++, Java, Rust, C#).
  - When the scan completes, a summary card shows the exit code and total primitives discovered.

---

## Step 4: Explore Discovered Findings (3:30 – 4:30)

- **Target Route**: `/findings`
- **What to Show**:
  - **Findings Table**: Lists detected cryptographic weaknesses (e.g., MD5 usage, DES/3DES ciphers, weak RSA keys < 2048 bits, insecure TLS configurations).
  - **Filters**: Filter findings by Severity (Critical, High, Medium, Low) and Status.
  - **Evidence Drawer**: Click a finding to view:
    - Target file path and line number.
    - Code snippet context with sensitive key bytes strictly redacted.
    - Assigned rule identifier (e.g., `ECDAT-STATIC-MD5`, `ECDAT-STATIC-WEAK-RSA`).
    - Associated NIST SP 800-131A and post-quantum migration impact.

---

## Step 5: CycloneDX CBOM Viewer (4:30 – 5:30)

- **Target Route**: `/cbom`
- **What to Show**:
  - **Cryptographic Bill of Materials**: Demonstrates compliance with the CycloneDX 1.6 and 1.7 specifications.
  - **Component Breakdown**: View cryptographic assets organized by category:
    - **Algorithms**: Family, primitive, key length, mode of operation.
    - **Certificates**: Subject, issuer, validity period, signature algorithm, key size.
    - **Protocols**: Negotiated TLS versions and cipher suites.
    - **Related Material**: Safe key metadata with zero cleartext secret leakage.
  - **Export Options**: Export the complete CBOM JSON for ingestion into downstream enterprise security tools.

---

## Step 6: Crypto Graph & Blast Radius Simulation (5:30 – 6:30)

- **Target Route**: `/graph`
- **What to Show**:
  - **Topology Mapping**: The interactive React Flow diagram deterministically maps out the 6-tier cryptographic lineage (Applications -> Services -> Certificates -> Protocols -> Algorithms -> Data).
  - **Blast Radius Simulation**: Open the filter panel and drag the **Quantum Arrival Year** slider.
    - Demonstrates Mosca's Theorem ($X + Y > Z$) dynamically in the UI.
    - Watch as nodes visually explode into red "AFFECTED" warning states if their data shelf-life outlasts the quantum arrival time.
  - **Inspect Nodes**: Click on any node to open the right-side details panel, which safely wraps long file paths and provides evidence attribution.

---

## Step 7: Remediation Lifecycle & Role Separation (6:30 – 7:30)

- **Target Route**: `/remediation`
- **What to Show**:
  - **Propose Migration Plan**:
    - An Analyst selects an identified finding (e.g., MD5 in hashing routine or RSA-1024).
    - The engine generates a recommended replacement (e.g., SHA-256 / SHA-3 or ML-KEM).
    - Click **"Propose Plan"** to generate an automated code diff.
  - **Diff Review**: Inspect the unified diff showing the exact proposed code replacement.
  - **Role-Separated Approval**:
    - The proposal enters `PENDING_REVIEW` state.
    - Analysts cannot approve their own proposed plans.
    - An Administrator reviews and approves or applies the plan.
    - The path-confinement safety engine guarantees all modifications remain within repository boundaries.

---

## Step 8: Verification & Audit Evidence (7:30 – 8:00)

- **Target Route**: `/reports` or `/audit`
- **What to Show**:
  - **Audit Trail**: Every action (scan initiation, finding triage, remediation proposal, remediation approval) is recorded with an immutable timestamp, user identifier, and tenant context.
  - **Re-Scan Verification**: Triggering a post-remediation scan confirms the finding is resolved and the policy gate transitions to a passing state.
  - **Export Reports**: Generate downloadable technical and executive summaries in JSON or Markdown format.
