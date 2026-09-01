'use client';

/**
 * DocFlow — API client
 *
 * Thin fetch wrapper that adds the bearer token, normalises errors, and
 * speaks to the real NestJS API (auth module + others). Responses from the
 * API are envelope-wrapped as { data: ... } by the global TransformInterceptor;
 * this client unwraps them transparently.
 *
 * Base URL comes from NEXT_PUBLIC_API_URL (default http://localhost:4000/api/v1).
 *
 * On a 401 from any non-auth endpoint, the request is retried exactly once
 * after a token refresh. The refresh is shared across concurrent 401s
 * (single in-flight promise) — see `auth-refresh.ts` for the full flow.
 */

import {
  API_BASE as REFRESH_API_BASE,
  forceClearAndRedirect,
  getAccessToken,
  refreshSession,
} from './auth-refresh';

export interface ApiError extends Error {
  status: number;
  code?: string;
}

const API_BASE = REFRESH_API_BASE;

/** Unwrap the { data: ... } envelope the API returns. */
function unwrap<T>(payload: any): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return payload.data as T;
  }
  return payload as T;
}

/**
 * Execute a fetch that may optionally attempt ONE refresh+retry on a 401.
 * Skips the interceptor on the login and refresh endpoints themselves so a
 * 401 there means "bad credentials", not "expired token".
 */
async function fetchWithAuthRetry(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const res = await fetch(path, init);
  if (res.status !== 401) return res;
  if (path.endsWith('/auth/login') || path.endsWith('/auth/refresh')) {
    return res;
  }
  if (!getAccessToken()) return res;

  const next = await refreshSession();
  if (!next) return res;

  const headers = new Headers(init.headers ?? {});
  headers.set('Authorization', `Bearer ${next.accessToken}`);
  return fetch(path, { ...init, headers });
}

async function request<T>(
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const url = `${API_BASE}${path}`;

  let res: Response;
  try {
    res = await fetchWithAuthRetry(url, {
      ...init,
      method: init?.method ?? 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // API unreachable — surface as a real error the login page can show.
    const err: ApiError = Object.assign(
      new Error('Não foi possível contactar o servidor.'),
      { status: 0 },
    );
    throw err;
  }

  if (!res.ok) {
    const err: ApiError = Object.assign(new Error(`HTTP ${res.status}`), {
      status: res.status,
    });
    try {
      const data = await res.json();
      // API error envelope: { statusCode, error, message, path, timestamp }
      if (data?.message) err.message = data.message;
      if (data?.code) err.code = data.code;
    } catch {
      // ignore parse failure
    }
    throw err;
  }

  const json = await res.json();
  return unwrap<T>(json);
}

/**
 * Flatten the API auth response ({ user, tenant, tokens: { accessToken, refreshToken } })
 * to the flat shape the UI pages expect ({ accessToken, refreshToken, user, tenant,
 * requiresTwoFactor }).
 */
function normalizeAuth(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  const tokens = payload.tokens ?? {};
  return {
    ...payload,
    accessToken: payload.accessToken ?? tokens.accessToken ?? null,
    refreshToken: payload.refreshToken ?? tokens.refreshToken ?? null,
    requiresTwoFactor:
      payload.requiresTwoFactor ?? payload.twoFactorRequired ?? false,
  };
}

export const apiClient = {
  login: (body: { email: string; password: string; tenantSlug: string; remember?: boolean }) =>
    // API DTO whitelists fields — send only what it accepts (drop `remember`).
    request('/auth/login', {
      email: body.email,
      password: body.password,
      tenantSlug: body.tenantSlug,
    }).then(normalizeAuth),
  register: (body: {
    email: string;
    tenantName: string;
    password: string;
    terms: boolean;
  }) => request('/auth/register', body).then(normalizeAuth),
  forgotPassword: (body: { email: string }) =>
    request('/auth/forgot-password', body),
  resetPassword: (body: { token: string; password: string }) =>
    request('/auth/reset-password', body),
  setup2fa: (body: { code: string }) =>
    request('/auth/2fa/setup', body),
  verify2fa: (body: { code: string }) =>
    request('/auth/2fa/verify', body),
};

export type ApiClient = typeof apiClient;

// Re-export the helper so existing imports keep working.
export { forceClearAndRedirect };