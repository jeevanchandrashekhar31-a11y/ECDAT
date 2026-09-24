/**
 * Safe URL Handling & Open Redirect Protection — Phase 17.3
 *
 * Enforces protocol whitelisting, prevents JavaScript/VBScript pseudo-protocols,
 * thwarts CVE-2025-68470 backslash open-redirect bypasses, and secures anchor links.
 */

export const DEFAULT_ALLOWED_PROTOCOLS = ['http:', 'https:'];

export interface SafeUrlOptions {
 allowRelative?: boolean;
 allowedProtocols?: string[];
 fallbackUrl?: string;
}

/**
 * Validates whether a URL or path is strictly safe for navigation or resource loading.
 */
export function isSafeUrl(rawUrl: unknown, options: SafeUrlOptions = {}): boolean {
 const { allowRelative = true, allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS } = options;

 if (!rawUrl || typeof rawUrl !== 'string') {
 return false;
 }

 const trimmed = rawUrl.trim();
 if (!trimmed) return false;

 // 1. Defend against control characters, NULL bytes, and non-printable characters
 // eslint-disable-next-line no-control-regex
 if (/[\x00-\x1F\x7F]/.test(trimmed)) {
 return false;
 }

 // 2. Defend against CVE-2025-68470 / CVE-2024-43795: backslashes used to spoof relative URLs into external redirects
 // E.g., `/\example.com`, `\/example.com`, `\\example.com`, `\example.com`
 if (trimmed.includes('\\')) {
 return false;
 }

 // 3. Defend against protocol-relative URLs (e.g. `//attacker.com`)
 if (trimmed.startsWith('//')) {
 return false;
 }

 // 4. Defend against dangerous schemes: javascript:, vbscript:, data:, file:
 // Strip whitespace/tabs inside pseudo protocol strings (e.g., `jav\tascript:`)
 const sanitizedScheme = trimmed.replace(/\s+/g, '').toLowerCase();
 if (
 sanitizedScheme.startsWith('javascript:') ||
 sanitizedScheme.startsWith('vbscript:') ||
 sanitizedScheme.startsWith('data:') ||
 sanitizedScheme.startsWith('file:') ||
 sanitizedScheme.startsWith('blob:')
 ) {
 return false;
 }

 // 5. Handle relative URLs
 if (trimmed.startsWith('/')) {
 return allowRelative;
 }

 // 6. Parse and check absolute URLs
 try {
 const parsed = new URL(trimmed);
 const validProtocols = new Set(allowedProtocols.map((p) => (p.endsWith(':') ? p : `${p}:`)));
 return validProtocols.has(parsed.protocol);
 } catch {
 // If it cannot be parsed as a URL and is not a relative path, it's unsafe
 return false;
 }
}

/**
 * Sanitizes a URL, returning a guaranteed safe string or a safe fallback.
 */
export function sanitizeUrl(rawUrl: unknown, fallback: string = 'about:blank'): string {
 if (isSafeUrl(rawUrl, { allowRelative: true })) {
 return (rawUrl as string).trim();
 }
 return fallback;
}

/**
 * Returns safe anchor tag props, automatically attaching rel="noopener noreferrer"
 * for external links and target="_blank".
 */
export function getSafeAnchorProps(
 url: string,
 external: boolean = false
): {
 href: string;
 target?: string;
 rel?: string;
} {
 const safeHref = sanitizeUrl(url, '#');

 if (external || isExternalUrl(url)) {
 return {
 href: safeHref,
 target: '_blank',
 rel: 'noopener noreferrer',
 };
 }

 return {
 href: safeHref,
 };
}

/**
 * Determines whether a URL points to an external origin.
 */
export function isExternalUrl(rawUrl: string): boolean {
 if (!rawUrl || typeof rawUrl !== 'string') return false;
 const trimmed = rawUrl.trim();
 if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.includes('\\')) {
 return false;
 }
 // Pseudo-protocols or non-web schemes are not external navigation targets
 const lower = trimmed.toLowerCase();
 if (
 lower.startsWith('javascript:') ||
 lower.startsWith('vbscript:') ||
 lower.startsWith('data:') ||
 lower.startsWith('blob:') ||
 lower.startsWith('file:')
 ) {
 return false;
 }
 try {
 const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
 if (typeof window !== 'undefined') {
 return parsed.origin !== window.location.origin;
 }
 return true;
 } catch {
 return false;
 }
}

/**
 * Validates a redirection target path, ensuring it stays within allowed application paths.
 */
export function validateRedirect(targetPath: unknown, allowedPrefixes: string[] = ['/']): string {
 if (typeof targetPath !== 'string') return '/';
 const trimmed = targetPath.trim();

 // Enforce relative path, no backslashes, no protocol-relative
 if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
 return '/';
 }

 // Prevent directory traversal attacks inside path
 if (trimmed.includes('/../') || trimmed.endsWith('/..')) {
 return '/';
 }

 const isAllowed = allowedPrefixes.some((prefix) => trimmed.startsWith(prefix));
 return isAllowed ? trimmed : '/';
}
