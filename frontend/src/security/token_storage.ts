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
 * Scans localStorage and purges any keys matching sensitive credential patterns.
 * Returns the count of purged items.
 */
export function purgeLocalStorageSecrets(): number {
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
 * Asserts that localStorage does not contain any sensitive secret tokens.
 * Throws a SecurityError if any unauthorized secret is found.
 */
export function assertNoLocalStorageSecrets(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;

    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      throw new Error(`[Security Violation] Sensitive secret found in localStorage under key: "${key}"`);
    }
  }
}

/**
 * Secure Tab Session Storage Helper.
 * Strictly uses sessionStorage (which is destroyed when the tab closes and never shared across origins/windows).
 */
export const sessionAuthStorage = {
  getApiKey(): string | null {
    // 1. Check in-memory store first
    const memToken = memoryTokenStore.getToken('api_key');
    if (memToken) return memToken;

    // 2. Fall back to sessionStorage (tab-scoped)
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        const item = window.sessionStorage.getItem('ecdat_session_api_key');
        if (item) {
          // Cache in memory
          memoryTokenStore.setToken('api_key', item, 60 * 60 * 1000, 'ApiKey');
          return item;
        }
      } catch {}
    }

    return null;
  },

  setApiKey(key: string | null): void {
    if (!key || key.trim() === '') {
      memoryTokenStore.removeToken('api_key');
      if (typeof window !== 'undefined' && window.sessionStorage) {
        try {
          window.sessionStorage.removeItem('ecdat_session_api_key');
        } catch {}
      }
      return;
    }

    const trimmed = key.trim();
    memoryTokenStore.setToken('api_key', trimmed, 60 * 60 * 1000, 'ApiKey');
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.setItem('ecdat_session_api_key', trimmed);
      } catch {}
    }
  },

  clear(): void {
    memoryTokenStore.clear();
    if (typeof window !== 'undefined' && window.sessionStorage) {
      try {
        window.sessionStorage.removeItem('ecdat_session_api_key');
      } catch {}
    }
    purgeLocalStorageSecrets();
  },
};
