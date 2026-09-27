# 🎯 ECDAT — Judge Presentation & Demo Guide

> **Audience**: SIH Evaluators / Technical Judges  
> **Duration**: 8–10 minutes  
> **Live URL**: `http://localhost:5173` 

---

## ⚡ TL;DR — The 60-Second Pitch

> *"Every organization running RSA, ECC, or legacy TLS is sitting on a quantum time bomb. Nobody knows where it is. ECDAT finds it, scores it using Nobel-level cryptographic math, and shows you exactly how to fix it — before Q-Day arrives."*

ECDAT automates the **entire PQC migration lifecycle**:

```
DISCOVER crypto →  ASSESS quantum risk  →  PRIORITIZE by Mosca score  →  REMEDIATE with governance  →  VERIFY compliance
```

---

## 🖥️ Pre-Demo Setup (Do This Before Judges Arrive)

### Option A — Local (Fastest)
```bash
# Terminal 1 — Backend
cd backend
AUTH_MODE=demo npm start
# ✅ Backend ready on http://localhost:3001

# Terminal 2 — Frontend  
cd frontend
npm run dev
# ✅ Frontend ready on http://localhost:5173
```

### Option B — Already Deployed (Recommended for SIH)
Use your Railway or Render URL — no setup needed for judges.

### Pre-load a scan result
Before the presentation, run one scan on `https://github.com/jeevanchandrashekhar31-a11y/ECDAT.git` so the dashboard has real data. Judges can then see findings immediately without waiting.

---

## 🎭 Step-by-Step Demo Script

### **Step 1: Enter Demo Mode** `(0:00 – 0:30)` — `/login`

- Click **"Enter Demo Mode"** below the standard login form
- **What to say**: *"ECDAT has a zero-friction demo mode for evaluation. A real enterprise deployment would integrate with Okta, Azure AD, or any OIDC provider. Clicking this provisions an authenticated session scoped to the demo tenant with analyst privileges — no credentials required."*
- ✅ You land directly on `/dashboard`

---

### **Step 2: Executive Dashboard** `(0:30 – 1:30)` — `/dashboard`

- **What to show**: Scroll through the 13 enterprise dashboard views
  - Risk distribution (CRITICAL_URGENT / AT_RISK / WATCH / SAFE)
  - Mosca's Theorem score summary
  - Severity heatmap by algorithm family
  - Top risky assets, most common algorithms
- **What to say**: *"The dashboard uses Mosca's Theorem — D + T > Q — to classify every cryptographic asset. If the data's shelf life plus migration time exceeds the quantum arrival estimate, we flag it CRITICAL URGENT. This isn't a 1-10 CVSS score — it's actual cryptographic risk mathematics from a published academic theorem."*

> 💡 **Judge talking point**: *"No other open-source tool does this. Commercial alternatives like IBM Quantum Safe cost hundreds of thousands of dollars annually."*

---

### **Step 3: Run a Live Scan** `(1:30 – 3:00)` — Click ⊕ on Dashboard

- Click the **➕ / New Scan** button on the dashboard
- Select **Live Scanner → Static Code → Git Repository URL**
- Paste: `https://github.com/jeevanchandrashekhar31-a11y/ECDAT.git`
- Set Policy Profile: `ECDAT Enterprise Crypto Baseline`
- Set Deployment Context: `Internet-Facing`
- Set Threat Horizon: `Baseline — 2033`
- Click **"Run Live Scan & Ingest"**

**What judges see while scanning:**
- 🔄 Rotating progress messages (Cloning… → Discovering… → Analysing call graph… → Generating CBOM…)
- 🟥 **Stop Scan button** appears — *"If a scan runs too long, users can stop it instantly. The frontend aborts the request and the server sends SIGKILL to the subprocess — no zombie processes."*

- **What to say**: *"The scanner shallow-clones the repo, parses 9 programming languages using Tree-sitter Abstract Syntax Trees, runs 350+ cryptographic API signature patterns, and outputs a CycloneDX 1.7 CBOM — all in under 60 seconds for a typical codebase."*

---

### **Step 4: Explore Findings** `(3:00 – 4:30)` — `/findings`

- **Filter by `CRITICAL_URGENT`** to show the highest-risk items first
- **Click any finding** to open the Evidence Drawer

**In the Evidence Drawer, highlight:**
| Field | What to Say |
|---|---|
| File path + line number | *"Exact code location — no hunting."* |
| Algorithm + key size | *"RSA-1024 — already below NIST minimum."* |
| Mosca classification | *"D+T>Q: this is quantum-exploitable before migration can complete."* |
| NIST PQC replacement | *"Replace with ML-KEM (FIPS 203) — the standard finalized August 2024."* |
| Code snippet (redacted) | *"Sensitive key bytes are redacted — we never expose raw secrets in the UI."* |

> 💡 **Judge talking point**: *"Most scanners just tell you there's a problem. ECDAT tells you the math behind why it's a problem AND what standard to migrate to."*

---

### **Step 5: CycloneDX CBOM Viewer** `(4:30 – 5:00)` — `/cbom`

- Show the generated **CycloneDX 1.6/1.7 CBOM**
- Highlight the component categories: Algorithms, Certificates, Protocols, Related Material
- Click **Download JSON** to show the export

**What to say**: *"This CBOM is a machine-readable cryptographic inventory that can be fed into any enterprise security tool — Dependency-Track, SIEM systems, or compliance reporting. CycloneDX is the OWASP standard. We support v1.6 and v1.7."*

---

### **Step 6: Blast Radius Simulator** `(5:00 – 6:00)` — `/graph`

- Open the **Crypto Graph** page
- Open the **Topology & Blast Radius Filters** panel (right side)
- **Drag the "Quantum Arrival Year" slider** from 2035 → 2030

**What judges see:**
- Nodes explode into 🔴 **AFFECTED** state in real-time
- The cascade shows which applications, services, and data flows break when a specific algorithm is compromised

**What to say**: *"This is what a quantum breach looks like — visually. Drag the slider to simulate different Q-Day scenarios. The cascade shows your actual attack surface. No other tool visualises this. This is the feature that justifies the entire platform."*

---

### **Step 7: Four-Eyes Remediation** `(6:00 – 7:30)` — `/remediation`

- Select a finding → Click **"Propose Remediation"**
- Show the auto-generated code diff (e.g., RSA → ML-KEM)
- **Switch to a different role** to attempt approval

**Demonstrate Separation of Duties:**
- As Developer: can only PROPOSE
- Try to approve your own proposal → ❌ **Blocked**
- Switch to Reviewer role → REVIEW the proposal  
- Switch to Admin role → APPROVE and APPLY

**What to say**: *"ECDAT implements a formal four-eyes cryptographic governance pipeline: PROPOSE → REVIEW → APPROVE → APPLY → VERIFY. The developer who proposes a fix is mathematically prevented from approving it. This satisfies SOX, PCI DSS, and DORA requirements for change management separation of duties."*

> 💡 **Judge talking point**: *"This is where ECDAT becomes a governance platform, not just a scanner. Compliance teams need this audit trail."*

---

### **Step 8: Reports & Audit Trail** `(7:30 – 8:30)` — `/reports`

- Click **"Generate Report"** → show the executive summary
- Navigate to **Audit Trail** view on the dashboard
- Show the immutable log: every scan, approval, and access with timestamp + actor ID

**What to say**: *"Every action is recorded — scan initiation, finding triage, proposal, approval. This is your compliance evidence trail. In a regulated environment, this log is what you hand to an auditor."*

---

### **Step 9: PQC Migration Roadmap** `(8:30 – 9:00)` — `/roadmap`

- Show the **Mosca timeline** — projected when each asset becomes quantum-critical
- Point to the migration priority queue

**What to say**: *"This roadmap tells you not just what to fix, but in what order. Assets that will be breached soonest under Mosca's model appear first. This transforms a vague 'we should migrate' into a concrete, dated action plan."*

---

## 🏆 Key Differentiators — The "Why ECDAT?" Pitch

| Claim | Evidence |
|---|---|
| **98.2% F1 Accuracy** | Golden corpus: 40 files, 109 primitives, 0 false positives |
| **Mosca's Theorem** | Real risk math, not a 1-10 score |
| **CycloneDX v1.7** | Latest OWASP standard — machine-readable, interoperable |
| **Four-Eyes Governance** | SoD enforced at API layer — not just UI |
| **Stop Scan** | SIGKILL abort — no zombie processes, instant user control |
| **Container Hardening 100/100** | Verified by automated auditor: seccomp, cap_drop, read-only FS |
| **Multi-Tenant** | Full row-level isolation + SCAN_TENANT_FORBIDDEN sentinel |
| **Open Source** | MIT license — no vendor lock-in |

---

## 🚨 If Something Goes Wrong

| Problem | Fix |
|---|---|
| Scan runs forever | Click **🟥 Stop Scan** button — aborts instantly |
| "Database unavailable" | Check Neon connection string in `.env` |
| No findings on dashboard | Make sure a scan completed — check `/scans` for status |
| Login loop | Clear browser storage → refresh → try Demo Mode again |
| CORS error | Set `ALLOWED_ORIGINS=http://localhost:5173` in backend `.env` |
| Backend port conflict | Change `PORT=3002` in `.env`, update frontend `VITE_API_URL` |

---

## 📊 Numbers to Remember

> Recite these confidently when judges ask about scale and accuracy.

- **98.2%** — F1 Score on static cryptographic discovery
- **109** — Ground-truth primitives in our golden corpus
- **0** — False positives on non-crypto trap files
- **9** — Programming languages supported (Python, Java, Go, JS, TS, C, C++, Rust, Ruby)
- **350+** — Cryptographic API signature patterns
- **13** — Enterprise dashboard views
- **100/100** — Container hardening score
- **5** — Stage remediation governance pipeline (PROPOSE → REVIEW → APPROVE → APPLY → VERIFY)
- **3** — NIST PQC standards supported (FIPS 203 ML-KEM, FIPS 204 ML-DSA, FIPS 205 SLH-DSA)
