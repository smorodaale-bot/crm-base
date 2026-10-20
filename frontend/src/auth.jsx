import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const refreshed = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        });
        if (refreshed.ok) {
          const data = await refreshed.json();
          setToken(data.accessToken || data.token);
          setUser(data.user);
        } else {
          clearToken();
          setUser(null);
        }
      } catch {
        clearToken();
        setUser(null);
      } finally {
        clearTimeout(timer);
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  const value = useMemo(
    () => {
      const plan = user?.plan || 'BASIC';
      const features = {
        START: { qc: false, stock: true, stockImport: false, analytics_export: false },
        BASIC: { qc: false, stock: true, stockImport: true, analytics_export: false },
        ADVANCED: { qc: true, stock: true, stockImport: true, analytics_export: false },
        ULTRA: { qc: true, stock: true, stockImport: true, analytics_export: true },
      };
      const f = features[plan] || features.BASIC;
      return {
        user,
        setUser,
        loading,
        isSupervisor: user?.role === 'SUPERVISOR' || user?.role === 'ADMIN',
        isAdmin: user?.role === 'ADMIN',
        canWrite: user?.role !== 'READONLY',
        plan,
        subscriptionStatus: user?.subscriptionStatus || null,
        canQc: Boolean(f.qc),
        canStock: Boolean(f.stock),
        canStockImport: Boolean(f.stockImport),
        canAnalyticsExport: Boolean(f.analytics_export),
        async startLogin(email, password, remember = false) {
          return api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password, remember: Boolean(remember) }),
          });
        },
        async confirmLogin(email, code) {
          const data = await api('/auth/login/confirm', {
            method: 'POST',
            body: JSON.stringify({ email, code }),
          });
          setToken(data.accessToken || data.token);
          setUser(data.user);
          return data.user;
        },
        async acceptSession(data) {
          setToken(data.accessToken || data.token);
          setUser(data.user);
          return data.user;
        },

        async logout() {
          try {
            await api('/auth/logout', { method: 'POST', body: '{}' });
          } catch {
            /* ignore */
          }
          clearToken();
          setUser(null);
        },
      };
    },
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
