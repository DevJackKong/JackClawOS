import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, type UserProfile } from '../api.js';

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

const LS_USER_TOKEN = 'jackclaw_user_token';
const LS_USER_DATA = 'jackclaw_user_data';
const REFRESH_AHEAD_MS = 2 * 60 * 1000;

interface TokenPayload {
  exp?: number;
}

function decodeTokenPayload(token: string): TokenPayload | null {
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return null;
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as TokenPayload;
  } catch {
    return null;
  }
}

function getTokenExpiryMs(token: string): number | null {
  const payload = decodeTokenPayload(token);
  if (typeof payload?.exp !== 'number') return null;
  return payload.exp * 1000;
}

function isTokenExpired(token: string): boolean {
  const expMs = getTokenExpiryMs(token);
  if (!expMs) return false;
  return Date.now() >= expMs;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);

  const clearRefreshTimer = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  }, []);

  const clearSession = useCallback(() => {
    clearRefreshTimer();
    localStorage.removeItem(LS_USER_TOKEN);
    localStorage.removeItem(LS_USER_DATA);
    setToken(null);
    setUser(null);
  }, [clearRefreshTimer]);

  const persist = useCallback((nextToken: string, nextUser: AuthUser) => {
    localStorage.setItem(LS_USER_TOKEN, nextToken);
    localStorage.setItem(LS_USER_DATA, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const refreshSession = useCallback(async (currentToken: string): Promise<string> => {
    if (refreshInFlightRef.current) {
      await refreshInFlightRef.current;
      return localStorage.getItem(LS_USER_TOKEN) ?? currentToken;
    }

    const run = (async () => {
      try {
        const refreshed = await api.auth.refresh(currentToken);
        persist(refreshed.token, refreshed.user as AuthUser);
      } catch {
        try {
          const profile = await api.auth.me(currentToken);
          persist(currentToken, profile as AuthUser);
        } catch {
          clearSession();
          throw new Error('session_refresh_failed');
        }
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = run;
    await run;
    return localStorage.getItem(LS_USER_TOKEN) ?? currentToken;
  }, [clearSession, persist]);

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
    refreshInFlightRef.current = null;
    clearSession();
  }, [clearSession]);

  const updateUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    localStorage.setItem(LS_USER_DATA, JSON.stringify(nextUser));
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem(LS_USER_TOKEN);
    const storedUser = localStorage.getItem(LS_USER_DATA);

    if (!storedToken || !storedUser) {
      setLoading(false);
      return;
    }

    if (isTokenExpired(storedToken)) {
      clearSession();
      setLoading(false);
      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as AuthUser;
      setToken(storedToken);
      setUser(parsedUser);
    } catch {
      clearSession();
      setLoading(false);
      return;
    }

    api.auth.me(storedToken)
      .then(profile => {
        persist(storedToken, profile as AuthUser);
      })
      .catch(() => {
        clearSession();
      })
      .finally(() => setLoading(false));
  }, [clearSession, persist]);

  useEffect(() => {
    clearRefreshTimer();
    if (!token) return;

    const expiryMs = getTokenExpiryMs(token);
    if (!expiryMs) return;

    const delay = Math.max(expiryMs - Date.now() - REFRESH_AHEAD_MS, 0);
    refreshTimerRef.current = setTimeout(() => {
      void refreshSession(token).catch(() => undefined);
    }, delay);

    return () => clearRefreshTimer();
  }, [clearRefreshTimer, refreshSession, token]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, logout, updateUser }),
    [user, token, loading, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
