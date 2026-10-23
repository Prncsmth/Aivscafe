'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, NetworkError, api, onSessionEnded, refreshSession, setAccessToken } from './api';
import type { User } from './types';

const USER_CACHE_KEY = 'sms.user';
/** Offline sign-in only works this long after the last real (online) sign-in on this device. */
const OFFLINE_SESSION_MAX_MS = 12 * 60 * 60 * 1000;

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: User | null;
  status: Status;
  /** true when the server could not be reached and we are using the last signed-in profile for offline POS */
  offlineSession: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  retrySession: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function readCache(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as User & { verifiedAt?: number };
    // An old offline profile is not trusted: someone must sign in online again.
    if (!cached.verifiedAt || Date.now() - cached.verifiedAt > OFFLINE_SESSION_MAX_MS) return null;
    return { id: cached.id, name: cached.name, username: cached.username, role: cached.role };
  } catch {
    return null;
  }
}
function writeCache(u: User | null) {
  try {
    if (u) localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ id: u.id, name: u.name, username: u.username, role: u.role, verifiedAt: Date.now() }));
    else localStorage.removeItem(USER_CACHE_KEY);
  } catch {
    /* storage unavailable: offline sign-in just won't be remembered */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [offlineSession, setOfflineSession] = useState(false);

  const retrySession = useCallback(async () => {
    try {
      const r = await refreshSession();
      setUser(r.user);
      writeCache(r.user);
      setOfflineSession(false);
      setStatus('authenticated');
    } catch (e) {
      if (e instanceof NetworkError || (e instanceof ApiError && e.status >= 500)) {
        // Server unreachable: keep working offline as the last signed-in user (POS only).
        const cached = readCache();
        setUser(cached);
        setOfflineSession(!!cached);
        setStatus(cached ? 'authenticated' : 'anonymous');
      } else {
        writeCache(null);
        setUser(null);
        setOfflineSession(false);
        setStatus('anonymous');
      }
    }
  }, []);

  useEffect(() => {
    void retrySession();
    return onSessionEnded(() => {
      writeCache(null);
      setUser(null);
      setStatus('anonymous');
    });
  }, [retrySession]);

  // Leave offline mode as soon as the connection is back.
  useEffect(() => {
    if (!offlineSession) return;
    const onOnline = () => void retrySession();
    window.addEventListener('online', onOnline);
    const t = setInterval(() => void retrySession(), 30_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(t);
    };
  }, [offlineSession, retrySession]);

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post<{ accessToken: string; user: User }>('/auth/login', { username, password });
    setAccessToken(r.accessToken);
    setUser(r.user);
    writeCache(r.user);
    setOfflineSession(false);
    setStatus('authenticated');
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* offline: the cookie is cleared next time; local orders are kept */
    }
    setAccessToken(null);
    writeCache(null);
    setUser(null);
    setOfflineSession(false);
    setStatus('anonymous');
  }, []);

  return (
    <AuthContext.Provider value={{ user, status, offlineSession, login, logout, retrySession }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
