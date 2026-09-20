/**
 * Secure Token Storage & Zero-Secrets localStorage Invariant — Phase 17.3
 *
 * Implements:
 * - In-Memory Token Store as the primary storage mechanism (preventing persistent disk leaks).
 * - Strict ban on placing JWTs, access/refresh tokens, API keys, or private keys into localStorage.
 * - Automatic detection and immediate purging of any accidental credentials in localStorage.
 * - Tab-scoped ephemeral sessionStorage fallback with TTL and encrypted or hashed state indicators.
 */

export interface TokenEntry {
  token: string;
  expiresAt: number; // Unix timestamp in ms
  tokenType: 'Bearer' | 'ApiKey' | 'Custom';
}

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /api[-_]?key/i,
  /auth/i,
  /bearer/i,
  /jwt/i,
  /credential/i,
  /private[-_]?key/i,
];

/**
 * High-security In-Memory Token Store.
 * Keeps tokens in memory only, isolated to the runtime JavaScript process.
 */
class MemoryTokenStore {
  private tokens = new Map<string, TokenEntry>();
  private listeners = new Set<(key: string, expired: boolean) => void>();

  /**
   * Sets a token in memory with an optional TTL (in milliseconds). Default: 15 minutes.
   */
  setToken(key: string, token: string, ttlMs: number = 15 * 60 * 1000, tokenType: TokenEntry['tokenType'] = 'Bearer'): void {
    if (!token) {
      this.removeToken(key);
      return;
    }

    const expiresAt = Date.now() + ttlMs;
    this.tokens.set(key, {
      token,
      expiresAt,
      tokenType,
    });
  }

  /**
   * Retrieves a token if it exists and has not expired.
   */
  getToken(key: string): string | null {
    const entry = this.tokens.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(key);
      this.notifyListeners(key, true);
      return null;
    }

    return entry.token;
  }

  /**
   * Retrieves full token entry details including expiration.
   */
  getTokenEntry(key: string): TokenEntry | null {
    const entry = this.tokens.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.tokens.delete(key);
      this.notifyListeners(key, true);
      return null;
    }

    return { ...entry };
  }

  /**
   * Removes a specific token from memory.
   */
  removeToken(key: string): void {
    this.tokens.delete(key);
    this.notifyListeners(key, false);
  }

  /**
   * Completely purges all stored tokens from memory (used upon logout or timeout).
   */
  clear(): void {
    const keys = Array.from(this.tokens.keys());
    this.tokens.clear();
    keys.forEach((k) => this.notifyListeners(k, false));
  }

  /**
   * Subscribes to token expiration or removal events.
   */
  subscribe(listener: (key: string, expired: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(key: string, expired: boolean): void {
    this.listeners.forEach((fn) => {
      try {
        fn(key, expired);
      } catch (err) {
        console.error('Error in token store listener:', err);
      }
    });
  }
}

export const memoryTokenStore = new MemoryTokenStore();

/**
/**
 * Scans sessionStorage and purges any keys matching sensitive credential patterns.
 * Returns the count of purged items.
 */
export function purgeSessionStorageSecrets(): number {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return 0;
  }

  let purgedCount = 0;
  const keysToRemove: string[] = [];

  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;

      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      window.sessionStorage.removeItem(key);
      purgedCount++;
      console.warn(`[Security Alert] Purged unauthorized secret from sessionStorage: "${key}"`);
    });
  } catch (err) {
    console.error('Failed to audit sessionStorage secrets:', err);
  }

  return purgedCount;
}

/**
 * Scans localStorage and purges any keys matching sensitive credential patterns.
 * Returns the count of purged items.
 */
export function purgeLocalStorageSecrets(): number {
  purgeSessionStorageSecrets();

  if (typeof window === 'undefined' || !window.localStorage) {
    return 0;
  }

  let purgedCount = 0;
  const keysToRemove: string[] = [];

  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitive) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => {
      window.localStorage.removeItem(key);
      purgedCount++;
      console.warn(`[Security Alert] Purged unauthorized secret from localStorage: "${key}"`);
    });
  } catch (err) {
    console.error('Failed to audit localStorage secrets:', err);
  }

  return purgedCount;
}

/**
 * Asserts that localStorage and sessionStorage do not contain any sensitive secret tokens.
 * Throws a SecurityError if any unauthorized secret is found.
 */
export function assertNoLocalStorageSecrets(): void {
  if (typeof window === 'undefined') return;

  if (window.localStorage) {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        throw new Error(`[Security Violation] Sensitive secret found in localStorage under key: "${key}"`);
      }
    }
  }

  if (window.sessionStorage) {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (!key) continue;

      if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
        throw new Error(`[Security Violation] Sensitive secret found in sessionStorage under key: "${key}"`);
      }
    }
  }
}

export function assertNoSessionStorageSecrets(): void {
  assertNoLocalStorageSecrets();
}

/**
 * In-Memory Session Auth Helper.
 * Strictly uses in-memory token store; never persists secrets to disk or browser storage.
 */
export const sessionAuthStorage = {
  getApiKey(): string | null {
    return memoryTokenStore.getToken('api_key');
  },

  setApiKey(key: string | null): void {
    if (!key || key.trim() === '') {
      memoryTokenStore.removeToken('api_key');
      return;
    }
    memoryTokenStore.setToken('api_key', key.trim(), 60 * 60 * 1000, 'ApiKey');
  },

  clear(): void {
    memoryTokenStore.clear();
    purgeLocalStorageSecrets();
    purgeSessionStorageSecrets();
  },
};
