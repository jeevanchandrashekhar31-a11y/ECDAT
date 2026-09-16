/**
 * CSRF Protection & Double-Submit Header Management — Phase 17.3
 *
 * Provides client-side CSRF token handling, cookie extraction,
 * and automatic header injection for mutating HTTP requests.
 */

const CSRF_COOKIE_NAME = 'ecdat_csrf_token';
const CSRF_HEADER_NAME = 'X-CSRF-Token';

let memoryCsrfToken: string | null = null;

/**
 * Extracts a specific cookie by name from document.cookie.
 */
export function getCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) {
    return null;
  }

  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [rawKey, rawVal] = cookie.split('=');
    if (rawKey && rawVal && rawKey.trim() === name) {
      try {
        return decodeURIComponent(rawVal.trim());
      } catch {
        return rawVal.trim();
      }
    }
  }

  return null;
}

/**
 * Retrieves the active CSRF token from memory or secure SameSite cookie.
 */
export function getCsrfToken(): string | null {
  if (memoryCsrfToken !== null) {
    return memoryCsrfToken;
  }
  const cookieToken = getCookie(CSRF_COOKIE_NAME);
  if (cookieToken) {
    return cookieToken;
  }
  return null;
}

/**
 * Sets the active CSRF token in memory.
 */
export function setCsrfToken(token: string | null): void {
  memoryCsrfToken = token ? token.trim() : null;
}

/**
 * Clears the CSRF token from both memory and cookie.
 */
export function clearCsrfToken(): void {
  memoryCsrfToken = null;
  if (typeof document !== 'undefined') {
    document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; path=/; SameSite=Strict`;
  }
}

/**
 * Determines whether an HTTP method is a state-changing mutating operation.
 */
export function isMutatingMethod(method?: string): boolean {
  if (!method) return false;
  const upper = method.toUpperCase();
  return upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE';
}

/**
 * Attaches the CSRF protection header to the given Headers object or plain object if applicable.
 */
export function attachCsrfHeader(
  headers: Headers | Record<string, string>,
  method?: string
): void {
  if (!isMutatingMethod(method)) {
    return;
  }

  const token = getCsrfToken();
  if (!token) {
    return;
  }

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    if (!headers.has(CSRF_HEADER_NAME)) {
      headers.set(CSRF_HEADER_NAME, token);
    }
  } else if (typeof headers === 'object' && headers !== null) {
    const record = headers as Record<string, string>;
    if (!record[CSRF_HEADER_NAME] && !record[CSRF_HEADER_NAME.toLowerCase()]) {
      record[CSRF_HEADER_NAME] = token;
    }
  }
}
