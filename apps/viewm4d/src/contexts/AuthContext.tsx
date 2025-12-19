import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { UserWithProjects } from '../types';

interface AuthContextType {
  user: UserWithProjects | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function decodeJwtPayload(token: string): { sub?: string } | null {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserWithProjects | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      setLoading(false);
      return;
    }

    const payload = decodeJwtPayload(token);
    if (!payload?.sub) {
      api.logout();
      setLoading(false);
      return;
    }

    api
      .getCurrentUser(payload.sub)
      .then(setUser)
      .catch(() => api.logout())
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { user: loggedInUser } = await api.login(email, password);
    const fullUser = await api.getCurrentUser(loggedInUser.id);
    setUser(fullUser);
  };

  const logout = () => {
    api.logout();
    setUser(null);
  };

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}


