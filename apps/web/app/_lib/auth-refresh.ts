'use client';

/**
 * DocFlow — shared token-refresh helper.
 *
 * Both `http.ts` (TanStack Query data calls) and `api-client.ts` (auth
 * login/register) route 401s through this module so the refresh+retry flow
 * is identical across the whole client. Guarded against:
 *
 *  - Infinite loops: the retry path carries a flag that skips the interceptor.
 *  - Stampedes: a single in-flight refresh promise is shared by every
 *    concurrent 401 — the second caller awaits the first one's result.
 *  - Refresh failure: any error clears the session and bounces the user to
 *    /login (preserving the original `next` path).
 *
 * Public surface:
 *  - `withAutoRefresh(doRequest)` — wraps any (path, init) request.
 *  - `forceClearAndRedirect()` — used when the session is poisoned.
 *  - `isJwtExpired(token)` — utility for the rehydrate guard.
 */

import { useAuthStore } from './auth-store';

export const API_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')) ||
  'http://localhost:4000/api/v1';

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}

/**
 * Decode a JWT payload (no signature verification — the server is the
 * source of truth). Returns null on malformed input.
 */
export function decodeJwt(token: string): { exp?: number; [k: string]: unknown } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * True when the token is a well-formed JWT whose `exp` claim is in the past
 * (or within a 5s skew). Returns false for non-JWT values.
 */
export function isJwtExpired(token: string | null | undefined): boolean {
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload || typeof payload.exp !== 'number') return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSec + 5;
}

/**
 * True when the token is well-formed (three segments of base64-ish chars)
 * — independent of whether the signature is trusted. Used by the rehydrate
 * guard to purge poisoned values left over from the old offline stub.
 */
export function looksLikeJwt(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.split('.').length === 3;
}

let inflightRefresh: Promise<RefreshResult | null> | null = null;

/**
 * Call POST /auth/refresh with the current refreshToken. On success the
 * auth-store is updated (which mirrors the new access token into the
 * `docflow-auth` cookie). Concurrent callers share one in-flight request.
 *
 * Returns the new pair on success, or null when refresh is impossible
 * (no stored refreshToken, or the API rejected it). On failure the session
 * is cleared and the user is bounced to /login.
 */
export async function refreshSession(): Promise<RefreshResult | null> {
  // Coalesce concurrent 401s onto a single refresh request.
  if (inflightRefresh) return inflightRefresh;

  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) {
    forceClearAndRedirect();
    return null;
  }

  inflightRefresh = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        forceClearAndRedirect();
        return null;
      }
      const json = await res.json();
      const data: RefreshResult = (json?.data ?? json) as RefreshResult;
      if (!data?.accessToken || !data?.refreshToken) {
        forceClearAndRedirect();
        return null;
      }
      // Persist the new pair via setSession — it also rewrites the cookie.
      useAuthStore.getState().setSession({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      return data;
    } catch {
      forceClearAndRedirect();
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

/**
 * Hard-clear the session and send the user to /login. Safe to call from
 * any module — falls back to no-op on the server.
 */
export function forceClearAndRedirect(): void {
  if (typeof window === 'undefined') return;
  useAuthStore.getState().clear();
  // Preserve a "next" hint when we're already on a protected route.
  const next =
    window.location.pathname.startsWith('/login') ||
    window.location.pathname.startsWith('/register') ||
    window.location.pathname.startsWith('/forgot-password') ||
    window.location.pathname.startsWith('/reset-password')
      ? ''
      : `?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  window.location.replace(`/login${next}`);
}

/**
 * Read the current bearer token from the store — kept in one place so
 * both http.ts and api-client.ts share the exact same source of truth.
 */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

/**
 * Shared `fetch` wrapper for callers that bypass http.ts/api-client.ts
 * (TanStack Query hooks that build their own URLs, XHR upload progress
 * flows, etc). Injects the bearer token, retries exactly once on a 401
 * after a token refresh, and never recurses on the refresh/login
 * endpoints themselves.
 */
export async function authedFetch(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = typeof input === 'string' ? input : input.toString();
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, { ...init, headers });

  // Fast path — happy response.
  if (res.status !== 401) return res;

  // Don't try to refresh on the auth endpoints themselves.
  if (
    url.endsWith('/auth/refresh') ||
    url.endsWith('/auth/login') ||
    url.includes('/auth/refresh?') ||
    url.includes('/auth/login?')
  ) {
    return res;
  }

  if (!token) return res; // no token → nothing to refresh against

  const next = await refreshSession();
  if (!next) return res;

  const retriedHeaders = new Headers(init.headers ?? {});
  retriedHeaders.set('Authorization', `Bearer ${next.accessToken}`);
  return fetch(url, { ...init, headers: retriedHeaders });
}
