# Reachability Evidence Document: Vitest Mock Redirect Vulnerability

**Advisory ID**: `GHSA-82fw-gwwq-j7x9`  
**Package**: `vitest`  
**Auditor**: ECDAT Security Architecture Team  
**Evaluation Date**: 2026-09-15T00:00:00Z  
**Determination**: Unreachable in Production Runtime Container

## Technical Reachability & Blast Radius Analysis

1. **Dependency Scope**:
   `vitest` is declared exclusively within the `devDependencies` block of `frontend/package.json`.
   It is never packaged into production release containers or client browser bundles.

2. **Build Isolation**:
   Production container builds execute:
   ```bash
   npm ci --omit=dev
   npm run build
   ```
   The resulting artifact contains only minified static assets (`dist/`) served via Nginx/Caddy. Vitest runtime code does not exist within the final artifact.

3. **Vulnerable Method Audit**:
   The advisory targets mock redirect handlers during active local test execution. The mock server is not bound to external network interfaces.

## Conclusion & Severity Reclassification
* **Base Upstream Severity**: MODERATE / HIGH
* **Reclassified Production Severity**: LOW (Tracked Improvement)
* **Status**: Evidenced and Formally Signed Off
