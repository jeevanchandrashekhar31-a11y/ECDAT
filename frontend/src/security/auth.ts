/**
 * Strict API Authorization & RBAC Interceptor — Phase 17.3
 *
 * Implements strict authorization enforcement, session expiration detection,
 * privilege escalation interception (401/403 handlers), and client-side RBAC checks.
 */

import { memoryTokenStore, sessionAuthStorage } from './token_storage';

export type UserRole = 'Admin' | 'SecurityLead' | 'Cryptographer' | 'Developer' | 'Auditor' | 'Viewer';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  Admin: 100,
  SecurityLead: 80,
  Cryptographer: 60,
  Developer: 40,
  Auditor: 30,
  Viewer: 10,
};

export interface AuthSession {
  userId?: string;
  tenantId?: string;
  role?: UserRole;
  permissions?: string[];
  isAuthenticated: boolean;
}

type AuthEventCallback = (session: AuthSession, error?: { status: number; message: string }) => void;

class AuthManager {
  private currentSession: AuthSession = {
    isAuthenticated: false,
    role: 'Viewer',
  };

  private unauthorizedCallbacks = new Set<AuthEventCallback>();
  private forbiddenCallbacks = new Set<AuthEventCallback>();

  /**
   * Updates the in-memory authorization session.
   */
  setSession(session: Partial<AuthSession>): void {
    this.currentSession = {
      ...this.currentSession,
      ...session,
      isAuthenticated: true,
    };
  }

  /**
   * Retrieves the current in-memory authorization session.
   */
  getSession(): AuthSession {
    return { ...this.currentSession };
  }

  /**
   * Clears the current authorization session and resets credentials.
   */
  clearSession(): void {
    this.currentSession = {
      isAuthenticated: false,
      role: 'Viewer',
    };
    sessionAuthStorage.clear();
    memoryTokenStore.clear();
  }

  /**
   * Evaluates whether the current user has at least the required role in the hierarchy.
   */
  hasRole(requiredRole: UserRole): boolean {
    const userRole = this.currentSession.role || 'Viewer';
    const userLevel = ROLE_HIERARCHY[userRole] || 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
    return userLevel >= requiredLevel;
  }

  /**
   * Evaluates whether the user has a specific required permission.
   */
  hasPermission(permission: string): boolean {
    if (this.currentSession.role === 'Admin') return true;
    const perms = this.currentSession.permissions || [];
    return perms.includes(permission);
  }

  /**
   * Attaches strict authorization and tenant headers to outgoing API requests.
   */
  attachAuthHeaders(headers: Headers | Record<string, string>): void {
    const apiKey = sessionAuthStorage.getApiKey();
    const token = memoryTokenStore.getToken('access_token');
    const tenantId = this.currentSession.tenantId;

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      } else if (apiKey && !headers.has('X-API-Key') && !headers.has('Authorization')) {
        headers.set('X-API-Key', apiKey);
      }
      if (tenantId && !headers.has('X-Tenant-Id')) {
        headers.set('X-Tenant-Id', tenantId);
      }
    } else if (typeof headers === 'object' && headers !== null) {
      const record = headers as Record<string, string>;
      if (token && !record['Authorization'] && !record['authorization']) {
        record['Authorization'] = `Bearer ${token}`;
      } else if (apiKey && !record['X-API-Key'] && !record['x-api-key'] && !record['Authorization']) {
        record['X-API-Key'] = apiKey;
      }
      if (tenantId && !record['X-Tenant-Id'] && !record['x-tenant-id']) {
        record['X-Tenant-Id'] = tenantId;
      }
    }
  }

  /**
   * Intercepts HTTP response status codes, notifying handlers if unauthorized or forbidden.
   */
  handleResponseStatus(status: number, message: string = ''): void {
    if (status === 401) {
      this.notifyUnauthorized({ status, message: message || 'Session expired or unauthenticated.' });
    } else if (status === 403) {
      this.notifyForbidden({ status, message: message || 'Insufficient permissions for resource.' });
    }
  }

  /**
   * Registers a listener for 401 Unauthorized events.
   */
  onUnauthorized(callback: AuthEventCallback): () => void {
    this.unauthorizedCallbacks.add(callback);
    return () => this.unauthorizedCallbacks.delete(callback);
  }

  /**
   * Registers a listener for 403 Forbidden events.
   */
  onForbidden(callback: AuthEventCallback): () => void {
    this.forbiddenCallbacks.add(callback);
    return () => this.forbiddenCallbacks.delete(callback);
  }

  private notifyUnauthorized(error: { status: number; message: string }): void {
    this.unauthorizedCallbacks.forEach((cb) => {
      try {
        cb(this.getSession(), error);
      } catch (err) {
        console.error('Error in onUnauthorized callback:', err);
      }
    });
  }

  private notifyForbidden(error: { status: number; message: string }): void {
    this.forbiddenCallbacks.forEach((cb) => {
      try {
        cb(this.getSession(), error);
      } catch (err) {
        console.error('Error in onForbidden callback:', err);
      }
    });
  }
}

export const authManager = new AuthManager();
