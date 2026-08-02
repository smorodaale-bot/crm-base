import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      try {
        const refreshed = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
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
        setLoading(false);
      }
    }
    bootstrap();
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isSupervisor: user?.role === 'SUPERVISOR' || user?.role === 'ADMIN',
      isAdmin: user?.role === 'ADMIN',
      canWrite: user?.role !== 'READONLY',
      async login(email, password) {
        const data = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
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
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
