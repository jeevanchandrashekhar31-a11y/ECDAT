import React, { useState, useEffect } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { authManager } from '../security';
import { api } from '../api/client';
import { Loader2 } from 'lucide-react';

/**
 * Route Guard for protected dashboard pages.
 * Prevents unauthenticated page rendering and blocks premature API data requests.
 * If no session exists, immediately redirects to /login.
 */
export const ProtectedRoute: React.FC = () => {
  const location = useLocation();
  const session = authManager.getSession();

  const [status, setStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>(() => {
    return session.isAuthenticated ? 'authenticated' : 'checking';
  });

  useEffect(() => {
    let active = true;

    if (session.isAuthenticated) {
      setStatus('authenticated');
      return;
    }

    // Verify if an existing valid session cookie or token is present
    api.getCurrentUser()
      .then((res) => {
        if (!active) return;
        if (res && res.authenticated) {
          const primaryRole = (res.user?.roles && res.user.roles[0]) || res.role || 'Viewer';
          authManager.setSession({
            userId: res.user?.userId,
            role: primaryRole as any,
            tenantId: res.user?.tenantId,
            isAuthenticated: true,
          });
          setStatus('authenticated');
        } else {
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (!active) return;
        setStatus('unauthenticated');
      });

    return () => {
      active = false;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin mb-3" />
        <p className="text-xs text-slate-400 font-medium tracking-wide">
          Verifying security session...
        </p>
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
};
