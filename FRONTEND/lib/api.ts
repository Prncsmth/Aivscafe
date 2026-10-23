/**
 * REST client for the Express API.
 * - Access token lives in memory only; the refresh token is an httpOnly cookie.
 * - 401 => one silent refresh + retry.
 * - No response (offline, DNS, timeout) => NetworkError, so callers can fall back to offline mode.
 */
/** Set NEXT_PUBLIC_API_URL in .env (see .env.example). It is inlined at build time. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'No connection to the server') {
    super(message);
    this.name = 'NetworkError';
  }
}

let accessToken: string | null = null;
let refreshing: Promise<RefreshResult> | null = null;
const listeners = new Set<(user: RefreshResult['user'] | null) => void>();

export interface RefreshResult {
  accessToken: string;
  user: { id: string; name: string; username: string; role: 'OWNER' | 'CASHIER' };
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function hasAccessToken() {
  return !!accessToken;
}
/** Notified when a refresh fails with 401 (session really ended). */
export function onSessionEnded(fn: (user: RefreshResult["user"] | null) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function rawFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(res: Response): Promise<{ data: T; meta?: Record<string, unknown> }> {
  let body: { success?: boolean; data?: T; meta?: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } } = {};
  try {
    body = await res.json();
  } catch {
    if (res.status >= 500) throw new ApiError(res.status, 'SERVER_ERROR', 'The server had a problem. Please try again.');
  }
  if (!res.ok || body.success === false) {
    throw new ApiError(res.status, body.error?.code ?? 'ERROR', body.error?.message ?? `Request failed (${res.status})`, body.error?.details);
  }
  return { data: body.data as T, meta: body.meta };
}

export function refreshSession(): Promise<RefreshResult> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await rawFetch('/auth/refresh', { method: 'POST' });
      const { data } = await parse<RefreshResult>(res);
      accessToken = data.accessToken;
      return data;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  const send = () =>
    rawFetch(path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      timeoutMs: init.timeoutMs,
    });
  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    try {
      await refreshSession();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        accessToken = null;
        listeners.forEach((fn) => fn(null));
      }
      throw e;
    }
    res = await send();
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>(path).then((r) => r.data),
  list: <T>(path: string) => request<T[]>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body }).then((r) => r.data),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }).then((r) => r.data),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }).then((r) => r.data),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }).then((r) => r.data),
};

export function errorMessage(e: unknown): string {
  if (e instanceof NetworkError) return 'No connection to the server. Check the internet and try again.';
  if (e instanceof ApiError) {
    if (e.code === 'VALIDATION_ERROR' && Array.isArray(e.details)) {
      return e.details.map((d: { path: string; message: string }) => `${d.path || 'field'}: ${d.message}`).join(' · ');
    }
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
