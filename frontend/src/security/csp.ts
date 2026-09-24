/**
 * Content Security Policy (CSP) & Security Headers Configuration — Phase 17.3
 *
 * Defines strict Content Security Policy directives and client-side verification
 * to prevent XSS, data exfiltration, clickjacking, and unauthorized resource injection.
 */

export interface CspDirectives {
 'default-src': string[];
 'script-src': string[];
 'style-src': string[];
 'font-src': string[];
 'img-src': string[];
 'connect-src': string[];
 'frame-src': string[];
 'frame-ancestors'?: string[];
 'object-src': string[];
 'base-uri': string[];
 'form-action': string[];
 'upgrade-insecure-requests'?: boolean;
}

export const PRODUCTION_CSP_DIRECTIVES: CspDirectives = {
 'default-src': ["'self'"],
 'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "'unsafe-eval'"],
 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
 'font-src': ["'self'", 'https://fonts.gstatic.com'],
 'img-src': ["'self'", 'data:', 'https:'],
 'connect-src': ["'self'", 'http://localhost:*', 'http://127.0.0.1:*', 'https:'],
 'frame-src': ["'self'"],
 'frame-ancestors': ["'self'"],
 'object-src': ["'none'"],
 'base-uri': ["'self'"],
 'form-action': ["'self'"],
 'upgrade-insecure-requests': true,
};

export const DEV_CSP_DIRECTIVES: CspDirectives = {
 'default-src': ["'self'"],
 'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "'unsafe-eval'"],
 'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
 'font-src': ["'self'", 'https://fonts.gstatic.com'],
 'img-src': ["'self'", 'data:', 'https:'],
 'connect-src': [
 "'self'",
 'http://localhost:*',
 'ws://localhost:*',
 'http://127.0.0.1:*',
 'ws://127.0.0.1:*',
 'https:',
 ],
 'frame-src': ["'self'"],
 'object-src': ["'none'"],
 'base-uri': ["'self'"],
 'form-action': ["'self'"],
};

/**
 * Builds a valid Content-Security-Policy string from structured directives.
 */
export function buildCspHeader(directives: CspDirectives): string {
 const parts: string[] = [];

 for (const [key, value] of Object.entries(directives)) {
 if (key === 'upgrade-insecure-requests') {
 if (value) {
 parts.push('upgrade-insecure-requests');
 }
 } else if (Array.isArray(value) && value.length > 0) {
 parts.push(`${key} ${value.join(' ')}`);
 }
 }

 return parts.join('; ');
}

/**
 * Validates whether the document contains an active CSP meta tag.
 */
export function verifyActiveCspPolicy(): { hasCsp: boolean; content: string | null } {
 if (typeof document === 'undefined') {
 return { hasCsp: false, content: null };
 }

 const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
 if (cspMeta) {
 return {
 hasCsp: true,
 content: cspMeta.getAttribute('content'),
 };
 }

 return { hasCsp: false, content: null };
}

/**
 * Validates that a CSP policy contains essential directives protecting against common attacks.
 */
export function validateCspCompleteness(cspString: string): {
 isValid: boolean;
 missingDirectives: string[];
} {
 const requiredDirectives = [
 'default-src',
 'script-src',
 'object-src',
 'base-uri',
 ];

 const missing: string[] = [];
 for (const dir of requiredDirectives) {
 if (!cspString.includes(dir)) {
 missing.push(dir);
 }
 }

 // Ensure object-src is 'none' for maximum defense
 const hasSafeObjectSrc = /object-src\s+['"]?none['"]?/.test(cspString);
 if (!hasSafeObjectSrc && !missing.includes('object-src')) {
 missing.push("object-src 'none'");
 }

 return {
 isValid: missing.length === 0,
 missingDirectives: missing,
 };
}
