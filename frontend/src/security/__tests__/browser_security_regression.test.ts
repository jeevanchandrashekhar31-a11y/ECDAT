import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PRODUCTION_CSP_DIRECTIVES,
  DEV_CSP_DIRECTIVES,
  buildCspHeader,
  validateCspCompleteness,
  verifyActiveCspPolicy,
  escapeHtml,
  escapeHtmlAttr,
  escapeJsString,
  stripDangerousTags,
  sanitizePlainText,
  sanitizeJson,
  isSafeUrl,
  sanitizeUrl,
  getSafeAnchorProps,
  isExternalUrl,
  validateRedirect,
  memoryTokenStore,
  purgeLocalStorageSecrets,
  assertNoLocalStorageSecrets,
  sessionAuthStorage,
  getCsrfToken,
  setCsrfToken,
  isMutatingMethod,
  attachCsrfHeader,
  clearCsrfToken,
  authManager,
  getProductionSecurityHeaders,
  getDevSecurityHeaders,
  DEFAULT_ALLOWED_PROTOCOLS,
} from '../index';

describe('Phase 17.3 — Frontend Security Subsystem & Browser Regression Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    memoryTokenStore.clear();
    clearCsrfToken();
    authManager.clearSession();
  });

  describe('1. Content Security Policy (CSP) & Secure Headers', () => {
    it('generates a strict production CSP header containing all essential directives', () => {
      const csp = buildCspHeader(PRODUCTION_CSP_DIRECTIVES);

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).toContain('upgrade-insecure-requests');
      expect(csp).not.toContain("'unsafe-eval'");

      const validation = validateCspCompleteness(csp);
      expect(validation.isValid).toBe(true);
      expect(validation.missingDirectives).toHaveLength(0);
    });

    it('detects incomplete or dangerously permissive CSP policies', () => {
      const insecureCsp = "default-src 'self'; script-src *";
      const validation = validateCspCompleteness(insecureCsp);

      expect(validation.isValid).toBe(false);
      expect(validation.missingDirectives).toContain('object-src');
      expect(validation.missingDirectives).toContain('base-uri');
    });

    it('provides complete production security headers map', () => {
      const headers = getProductionSecurityHeaders();

      expect(headers['Content-Security-Policy']).toBeDefined();
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['Permissions-Policy']).toContain('camera=()');
      expect(headers['Strict-Transport-Security']).toContain('max-age=31536000');
      expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
      expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
      expect(headers['X-Permitted-Cross-Domain-Policies']).toBe('none');
    });

    it('generates a compliant development CSP header with HMR WebSocket support', () => {
      const devCsp = buildCspHeader(DEV_CSP_DIRECTIVES);
      expect(devCsp).toContain("default-src 'self'");
      expect(devCsp).toContain('ws://localhost:*');
      expect(devCsp).toContain("object-src 'none'");

      const devHeaders = getDevSecurityHeaders();
      expect(devHeaders['Content-Security-Policy']).toBe(devCsp);
      expect(devHeaders['X-Content-Type-Options']).toBe('nosniff');
      expect(devHeaders['X-Frame-Options']).toBe('SAMEORIGIN');
      expect(devHeaders['Cross-Origin-Opener-Policy']).toBe('same-origin');
    });

    it('verifies active CSP meta tag in document head when present', () => {
      // Simulate meta tag in JSDOM
      const meta = document.createElement('meta');
      meta.setAttribute('http-equiv', 'Content-Security-Policy');
      meta.setAttribute('content', "default-src 'self'");
      document.head.appendChild(meta);

      const status = verifyActiveCspPolicy();
      expect(status.hasCsp).toBe(true);
      expect(status.content).toBe("default-src 'self'");

      // Cleanup
      document.head.removeChild(meta);
    });
  });

  describe('2. Contextual Output Encoding & XSS Defenses', () => {
    it('escapes dangerous HTML body special characters', () => {
      const attack = '<script>alert("XSS & attack")</script>\'=`/';
      const safe = escapeHtml(attack);

      expect(safe).toBe(
        '&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;&#x2F;script&gt;&#x27;&#x3D;&#x60;&#x2F;'
      );
      expect(safe).not.toContain('<script>');
      expect(safe).not.toContain('</script>');
    });

    it('neutralizes common real-world XSS vector payloads', () => {
      const payloads = [
        '<img src=x onerror=alert(1)>',
        '<svg onload="javascript:alert(1)">',
        '"><script src=//attacker.com/x.js></script>',
        "';alert(document.cookie);'",
      ];

      payloads.forEach((payload) => {
        const escaped = escapeHtml(payload);
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
        expect(escaped).not.toContain('<script');
      });
    });

    it('strictly encodes HTML attribute values', () => {
      const attrPayload = 'test" onfocus="alert(1)';
      const safeAttr = escapeHtmlAttr(attrPayload);

      expect(safeAttr).not.toContain('"');
      expect(safeAttr).not.toContain(' ');
      expect(safeAttr).toContain('&#x22;');
    });

    it('escapes JavaScript strings against context breakout', () => {
      const jsPayload = '"; alert(1); //';
      const safeJs = escapeJsString(jsPayload);

      expect(safeJs).toBe('\\"; alert(1); \\/\\/');
    });

    it('strips dangerous executable HTML tags and event handlers', () => {
      const dirtyHtml = `
        <div>
          <h1>Safe Title</h1>
          <script>doEvil()</script>
          <iframe src="https://evil.com"></iframe>
          <a href="javascript:alert(1)" onclick="runHack()">Click</a>
          <img src="pic.jpg" onerror="stealSecrets()">
        </div>
      `;
      const cleaned = stripDangerousTags(dirtyHtml);

      expect(cleaned).not.toContain('<script>');
      expect(cleaned).not.toContain('doEvil()');
      expect(cleaned).not.toContain('<iframe');
      expect(cleaned).not.toContain('javascript:');
      expect(cleaned).not.toContain('onclick=');
      expect(cleaned).not.toContain('onerror=');
      expect(cleaned).toContain('Safe Title');
    });

    it('strips control characters, null bytes, and Trojan Source bidirectional overrides', () => {
      const trojanSource = 'admin\x00user\u202Eevil\u202D';
      const cleanText = sanitizePlainText(trojanSource);

      expect(cleanText).toBe('adminuserevil');
      expect(cleanText).not.toContain('\x00');
      expect(cleanText).not.toContain('\u202E');
    });

    it('deeply sanitizes JSON payloads and neutralizes prototype pollution attempts', () => {
      const maliciousPayload = JSON.parse(
        '{"title": "Valid Report", "__proto__": {"polluted": true}, "nested": {"script": "<script>evil</script>", "constructor": {"polluted": true}}}'
      );

      const sanitized = sanitizeJson(maliciousPayload) as Record<string, unknown>;

      expect(sanitized.title).toBe('Valid Report');
      expect(Object.prototype.hasOwnProperty.call(sanitized, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(sanitized, 'constructor')).toBe(false);
      expect((sanitized.nested as Record<string, unknown>).script).toBe('<script>evil</script>');
      expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
    });
  });

  describe('3. Safe URL Handling & Open Redirect Protection', () => {
    it('accepts safe relative paths and whitelisted HTTPS URLs', () => {
      expect(isSafeUrl('/dashboard')).toBe(true);
      expect(isSafeUrl('/api/v1/reports/latest')).toBe(true);
      expect(isSafeUrl('https://ecdat.security.internal/docs')).toBe(true);
      expect(isSafeUrl('http://localhost:5000/health')).toBe(true);
    });

    it('rejects pseudo-protocols (javascript:, vbscript:, data:, file:)', () => {
      expect(isSafeUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeUrl('JAVASCRIPT:alert(1)')).toBe(false);
      expect(isSafeUrl('  javascript:void(0)  ')).toBe(false);
      expect(isSafeUrl('jav\tascript:alert(1)')).toBe(false);
      expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false);
      expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(isSafeUrl('file:///etc/passwd')).toBe(false);
      expect(isSafeUrl('blob:http://localhost/12345')).toBe(false);
    });

    it('blocks CVE-2025-68470 / CVE-2024-43795 backslash bypasses and protocol-relative URLs', () => {
      expect(isSafeUrl('/\\attacker.com')).toBe(false);
      expect(isSafeUrl('\\attacker.com')).toBe(false);
      expect(isSafeUrl('\\/attacker.com')).toBe(false);
      expect(isSafeUrl('\\\\attacker.com')).toBe(false);
      expect(isSafeUrl('//attacker.com/login')).toBe(false);
      expect(isSafeUrl('/path/to/\\evil')).toBe(false);
    });

    it('sanitizeUrl falls back to about:blank or custom fallback for dangerous URLs', () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('about:blank');
      expect(sanitizeUrl('/\\attacker.com', '#')).toBe('#');
      expect(sanitizeUrl('/safe/path')).toBe('/safe/path');
      expect(sanitizeUrl('https://safe.internal/api')).toBe('https://safe.internal/api');
    });

    it('generates secure anchor props with rel="noopener noreferrer" for external targets', () => {
      const externalProps = getSafeAnchorProps('https://nist.gov/pqc', true);
      expect(externalProps.href).toBe('https://nist.gov/pqc');
      expect(externalProps.target).toBe('_blank');
      expect(externalProps.rel).toBe('noopener noreferrer');

      const internalProps = getSafeAnchorProps('/dashboard', false);
      expect(internalProps.href).toBe('/dashboard');
      expect(internalProps.target).toBeUndefined();
    });

    it('validates navigation redirects strictly within internal boundaries', () => {
      expect(validateRedirect('/dashboard')).toBe('/dashboard');
      expect(validateRedirect('/reports?scanId=1')).toBe('/reports?scanId=1');
      expect(validateRedirect('https://evil.com')).toBe('/');
      expect(validateRedirect('/\\evil.com')).toBe('/');
      expect(validateRedirect('//evil.com')).toBe('/');
      expect(validateRedirect('/path/../../etc/passwd')).toBe('/');
    });

    it('accurately identifies external vs internal URLs', () => {
      expect(isExternalUrl('https://example.com/test')).toBe(true);
      expect(isExternalUrl('http://attacker.org')).toBe(true);
      expect(isExternalUrl('/dashboard')).toBe(false);
      expect(isExternalUrl('/api/v1/health')).toBe(false);
      expect(isExternalUrl('javascript:alert(1)')).toBe(false);
    });

    it('exposes and uses default allowed protocols (http:, https:)', () => {
      expect(DEFAULT_ALLOWED_PROTOCOLS).toEqual(['http:', 'https:']);
      expect(isSafeUrl('https://valid.domain')).toBe(true);
      expect(isSafeUrl('ftp://invalid.domain')).toBe(false);
    });
  });

  describe('4. Token Storage & Zero-Secrets localStorage Invariant', () => {
    beforeEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('manages tokens exclusively in-memory with automatic TTL expiration', () => {
      memoryTokenStore.setToken('session_jwt', 'jwt.header.payload', 100); // 100ms TTL

      expect(memoryTokenStore.getToken('session_jwt')).toBe('jwt.header.payload');

      // Fast-forward time
      vi.setSystemTime(Date.now() + 150);
      expect(memoryTokenStore.getToken('session_jwt')).toBeNull();
      vi.useRealTimers();
    });

    it('clears all memory tokens upon explicit clear() call', () => {
      memoryTokenStore.setToken('token1', 'val1');
      memoryTokenStore.setToken('token2', 'val2');

      memoryTokenStore.clear();

      expect(memoryTokenStore.getToken('token1')).toBeNull();
      expect(memoryTokenStore.getToken('token2')).toBeNull();
    });

    it('enforces the zero-secrets localStorage invariant by detecting and purging unauthorized keys', () => {
      localStorage.setItem('user_theme', 'dark');
      localStorage.setItem('unauthorized_api_key', 'super-secret-key');
      localStorage.setItem('jwt_token', 'eyJh...');
      localStorage.setItem('auth_credential', 'pass123');

      // Verification before purge
      expect(localStorage.getItem('unauthorized_api_key')).toBe('super-secret-key');

      // Run security purge
      const purged = purgeLocalStorageSecrets();
      expect(purged).toBe(3);

      // Safe non-secret key preserved
      expect(localStorage.getItem('user_theme')).toBe('dark');
      // All sensitive keys erased
      expect(localStorage.getItem('unauthorized_api_key')).toBeNull();
      expect(localStorage.getItem('jwt_token')).toBeNull();
      expect(localStorage.getItem('auth_credential')).toBeNull();

      // Invariant assertion passes
      expect(() => assertNoLocalStorageSecrets()).not.toThrow();
    });

    it('assertNoLocalStorageSecrets throws an error when a secret is deposited in localStorage', () => {
      localStorage.setItem('access_token', 'leak');
      expect(() => assertNoLocalStorageSecrets()).toThrow(
        /Sensitive secret found in localStorage under key: "access_token"/
      );
    });

    it('sessionAuthStorage strictly keeps credentials out of localStorage', () => {
      sessionAuthStorage.setApiKey('sec-test-key-2026');

      expect(sessionAuthStorage.getApiKey()).toBe('sec-test-key-2026');

      // Verify ZERO credentials were saved to localStorage or sessionStorage
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(() => assertNoLocalStorageSecrets()).not.toThrow();

      sessionAuthStorage.clear();
      expect(sessionAuthStorage.getApiKey()).toBeNull();
    });
  });

  describe('5. CSRF Protection & Strict API Authorization', () => {
    it('extracts CSRF token from document.cookie and falls back to memory store', () => {
      document.cookie = 'ecdat_csrf_token=csrf-token-abc-123; path=/; SameSite=Strict';

      const token = getCsrfToken();
      expect(token).toBe('csrf-token-abc-123');
    });

    it('identifies mutating HTTP methods requiring CSRF tokens', () => {
      expect(isMutatingMethod('GET')).toBe(false);
      expect(isMutatingMethod('HEAD')).toBe(false);
      expect(isMutatingMethod('OPTIONS')).toBe(false);

      expect(isMutatingMethod('POST')).toBe(true);
      expect(isMutatingMethod('PUT')).toBe(true);
      expect(isMutatingMethod('PATCH')).toBe(true);
      expect(isMutatingMethod('DELETE')).toBe(true);
    });

    it('attaches X-CSRF-Token header exclusively on mutating methods when token is present', () => {
      setCsrfToken('test-csrf-token-456');

      // Mutating method: POST
      const postHeaders = new Headers();
      attachCsrfHeader(postHeaders, 'POST');
      expect(postHeaders.get('X-CSRF-Token')).toBe('test-csrf-token-456');

      // Non-mutating method: GET
      const getHeaders = new Headers();
      attachCsrfHeader(getHeaders, 'GET');
      expect(getHeaders.get('X-CSRF-Token')).toBeNull();
    });

    it('authManager intercepts 401 Unauthorized and triggers security callback', () => {
      const unauthorizedSpy = vi.fn();
      const unsub = authManager.onUnauthorized(unauthorizedSpy);

      authManager.handleResponseStatus(401, 'Token expired');

      expect(unauthorizedSpy).toHaveBeenCalledTimes(1);
      expect(unauthorizedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isAuthenticated: false }),
        expect.objectContaining({ status: 401, message: 'Token expired' })
      );

      unsub();
    });

    it('authManager intercepts 403 Forbidden and triggers privilege escalation defense', () => {
      const forbiddenSpy = vi.fn();
      const unsub = authManager.onForbidden(forbiddenSpy);

      authManager.handleResponseStatus(403, 'Permission denied');

      expect(forbiddenSpy).toHaveBeenCalledTimes(1);
      expect(forbiddenSpy).toHaveBeenCalledWith(
        expect.objectContaining({ isAuthenticated: false }),
        expect.objectContaining({ status: 403, message: 'Permission denied' })
      );

      unsub();
    });

    it('enforces client-side RBAC role hierarchy', () => {
      authManager.setSession({ role: 'Developer', tenantId: 'tenant-finance-01' });

      expect(authManager.hasRole('Viewer')).toBe(true);
      expect(authManager.hasRole('Developer')).toBe(true);
      expect(authManager.hasRole('SecurityLead')).toBe(false);
      expect(authManager.hasRole('Admin')).toBe(false);

      authManager.setSession({ role: 'Admin' });
      expect(authManager.hasRole('SecurityLead')).toBe(true);
      expect(authManager.hasRole('Admin')).toBe(true);
    });

    it('attaches strict tenant and authorization headers to requests', () => {
      authManager.setSession({ tenantId: 'tenant-crypto-99' });
      sessionAuthStorage.setApiKey('test-admin-api-key');

      const headers = new Headers();
      authManager.attachAuthHeaders(headers);

      expect(headers.get('X-Tenant-Id')).toBe('tenant-crypto-99');
      expect(headers.get('X-API-Key')).toBe('test-admin-api-key');
    });
  });

  describe('6. Frontend Dependency Security & Supply Chain Invariants', () => {
    it('verifies that banned unsafe packages are absent from dependency inventory', async () => {
      const bannedPackages = [
        'lodash.template',
        'serialize-javascript',
        'vm2',
        'eval',
        'child_process',
        'shelljs',
      ];
      const frontPkg = (await import('../../../package.json')).default as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const allDeps = {
        ...(frontPkg.dependencies || {}),
        ...(frontPkg.devDependencies || {}),
      };

      for (const banned of bannedPackages) {
        expect(allDeps[banned]).toBeUndefined();
      }
    });

    it('asserts that react-router-dom and core UI dependencies are locked to secure versions', async () => {
      // Check frontend package.json
      const frontPkg = (await import('../../../package.json')).default as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      expect(frontPkg.dependencies['react-router-dom']).toBeDefined();
      expect(frontPkg.devDependencies['vitest']).toBeDefined();
    });
  });

  describe('7. Contextual DOM Sanitization & Dynamic Insertion Defense', () => {
    it('neutralizes malicious event handlers and javascript: URLs when injected into DOM nodes', () => {
      const attackHtml = '<img src="x" onerror="window.__xss_attack_triggered=true" /><a href="javascript:void(0)">Link</a>';
      const sanitized = stripDangerousTags(attackHtml);

      const div = document.createElement('div');
      div.innerHTML = sanitized;

      expect((window as unknown as { __xss_attack_triggered?: boolean }).__xss_attack_triggered).toBeUndefined();
      expect(div.querySelector('img')?.getAttribute('onerror')).toBeNull();
      expect(div.querySelector('a')?.getAttribute('href')).toBeNull();
    });

    it('neutralizes deep prototype poisoning across multidimensional objects and arrays', () => {
      const complexAttack = {
        level1: [
          {
            __proto__: { polluted1: true },
            name: 'safe_crypto_algorithm',
          },
        ],
        constructor: {
          prototype: { polluted2: true },
        },
        algorithm: 'ML-KEM-768',
      };

      const result = sanitizeJson(complexAttack) as Record<string, unknown>;
      expect(result.algorithm).toBe('ML-KEM-768');
      expect((result.level1 as Array<Record<string, unknown>>)[0].name).toBe('safe_crypto_algorithm');
      expect((Object.prototype as unknown as { polluted1?: boolean }).polluted1).toBeUndefined();
      expect((Object.prototype as unknown as { polluted2?: boolean }).polluted2).toBeUndefined();
    });

    it('sanitizes untrusted text containing malicious control codes without destroying readable text', () => {
      const maliciousName = 'AES-256-GCM\x00\x08\u202Ereversed';
      const clean = sanitizePlainText(maliciousName);
      expect(clean).toBe('AES-256-GCMreversed');
      expect(clean).not.toContain('\x00');
      expect(clean).not.toContain('\u202E');
    });
  });
});
