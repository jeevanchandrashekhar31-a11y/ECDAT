# ECDAT Frontend — React & Tailwind UI

Modern, judge-friendly, cyber-defense security dashboard visualizing cryptographic discovery, explainable risk assessment, Mosca Theorem quantum threat calculus ($X + Y > Z$), and NIST post-quantum migration targets.

---

## Architectural Highlights

- **Pure Consumption Layer**: Visualizes backend API responses (`/api/v1/*`); **zero** duplicated risk or threat calculations in the frontend.
- **Accessible & Contrast-Safe**: Full keyboard navigation, semantic HTML elements, and dual-encoded status badges (icon + text) for colorblind accessibility.
- **Zero Exposed Secrets**: All API communication runs through Vite's local dev proxy or reverse proxy (in Docker/production); optional session-stored API keys (`sessionStorage`) are never baked into bundle assets.
- **Interactive Mosca Calculus**: Visual breakdown of data shelf life ($X$), migration time ($Y$), and quantum horizon ($Z$), highlighting retroactive Store-Now-Decrypt-Later (SNDL) exposure windows.
- **CycloneDX 1.6 Export & Viewer**: Direct preview of the embedded standalone HTML executive report, and one-click export of risk-annotated or raw source CBOMs.

---

## Tech Stack

- **Framework**: [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Bundler & Dev Server**: [Vite 6](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v3](https://tailwindcss.com/) with custom cyber/quantum palette & glassmorphism
- **Charts & Visualizations**: [Recharts](https://recharts.org/) (Donut severity distribution & Mosca threat bar charts)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Routing**: [React Router v6](https://reactrouter.com/)

---

## Getting Started

### 1. Prerequisites

- Node.js 18+ (tested on Node.js 20 & 24)
- Running ECDAT backend instance on `http://localhost:5000` (or configured proxy target)

### 2. Installation

```bash
cd frontend
npm install
```

### 3. Development Server

Start the local dev server with hot module replacement (HMR) and backend proxying:

```bash
npm run dev
```

The frontend will be available at [http://localhost:3000](http://localhost:3000).

API requests to `/api/*` and `/health` are automatically forwarded to `http://localhost:5000`.

### 4. Production Build

Verify TypeScript compilation and produce an optimized distribution bundle in `dist/`:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

### 5. Docker Deployment

Build and run the production Nginx multi-stage container:

```bash
docker build -t ecdat-frontend .
docker run -p 3000:80 ecdat-frontend
```

---

## Page Overview

| Route | Page | Purpose |
|---|---|---|
| `/` | `Dashboard.tsx` | Executive summary KPIs, Recharts donuts, Mosca calculation table, top vulnerable assets, and PQC target priorities. |
| `/assets` | `Assets.tsx` | Filterable inventory table with search, severity filters, Mosca status pills, sensitivity tags, and pagination. |
| `/assets/:assetId` | `AssetDetail.tsx` | Deep-dive telemetry for a single cryptographic asset, including detected primitives, location, risk rules violated, Mosca formula breakdown, and PQC migration target. |
| `/reports` | `Reports.tsx` | Standalone HTML report iframe preview, CycloneDX 1.6 annotated/raw JSON download, and summary audit bundle export. |

---

## API Key Authentication (Optional)

If the backend has `ECDAT_API_KEY` enabled:
1. Click the **"API Key"** button in the top navigation bar.
2. Enter your key (e.g. `ecdat_demo_key_2026`).
3. It will be stored in `sessionStorage` (only for your current browser tab) and automatically sent in `X-API-Key` headers for write routes and uploads.
