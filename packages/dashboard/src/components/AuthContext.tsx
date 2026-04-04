// AuthContext — 认证上下文：user / token / login / logout / register
// 自动从 localStorage 恢复会话，token 过期时清除并重定向至登录页

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, type UserProfile } from '../api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser extends UserProfile {}

export interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (handle: string, password: string) => Promise<void>;
  register: (displayName: string, handle: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (u: AuthUser) => void;
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const LS_USER_TOKEN = 'jackclaw_user_token';
const LS_USER_DATA  = 'jackclaw_user_data';

// ── JWT exp helper ─────────────────────────────────────────────────────────

function isTokenExpired(token: string): boolean {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return true;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number') return false;
    return Date.now() / 1000 > payload.exp;
  } catch {
    return true;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser]     = useState<AuthUser | null>(null);
  const [token, setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore session from localStorage on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(LS_USER_TOKEN);
    const storedUser  = localStorage.getItem(LS_USER_DATA);

    if (storedToken && storedUser) {
      if (isTokenExpired(storedToken)) {
        // Expired — clear storage
        localStorage.removeItem(LS_USER_TOKEN);
        localStorage.removeItem(LS_USER_DATA);
      } else {
        try {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as AuthUser);
        } catch {
          localStorage.removeItem(LS_USER_TOKEN);
          localStorage.removeItem(LS_USER_DATA);
        }
      }
    }
    setLoading(false);
  }, []);

  // Periodic expiry check (every 60s)
  useEffect(() => {
    if (!token) return;
    const iv = setInterval(() => {
      if (isTokenExpired(token)) {
        localStorage.removeItem(LS_USER_TOKEN);
        localStorage.removeItem(LS_USER_DATA);
        setToken(null);
        setUser(null);
      }
    }, 60_000);
    return () => clearInterval(iv);
  }, [token]);

  const persist = useCallback((t: string, u: AuthUser) => {
    localStorage.setItem(LS_USER_TOKEN, t);
    localStorage.setItem(LS_USER_DATA, JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const login = useCallback(async (handle: string, password: string) => {
    const res = await api.auth.login({ handle, password });
    persist(res.token, res.user);
  }, [persist]);

  const register = useCallback(async (
    displayName: string,
    handle: string,
    password: string,
  ) => {
    const res = await api.auth.register({ displayName, handle, password });
    persist(res.token, res.user);
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(LS_USER_TOKEN);
    localStorage.removeItem(LS_USER_DATA);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((u: AuthUser) => {
    setUser(u);
    localStorage.setItem(LS_USER_DATA, JSON.stringify(u));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, logout, updateUser }),
    [user, token, loading, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
