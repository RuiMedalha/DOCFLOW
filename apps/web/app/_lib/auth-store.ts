'use client';

/**
 * DocFlow — Auth Store (zustand)
 *
 * Holds the lightweight authentication state: email, tenant, tokens.
 * Server data (session, permissions, profile) belongs in TanStack Query —
 * this store is intentionally small and synchronously readable from any
 * client component without triggering re-fetches.
 *
 * The access token is mirrored into a non-HTTPOnly cookie so edge
 * middleware can enforce the auth gate (it cannot read localStorage).
 * The cookie value is the raw JWT, which is readable from the client
 * anyway, so there is no extra exposure surface.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isJwtExpired, looksLikeJwt } from './auth-refresh';

export interface AuthSnapshot {
  email: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  requiresTwoFactor: boolean;
}

interface AuthState extends AuthSnapshot {
  setSession: (s: Partial<AuthSnapshot>) => void;
  setRequiresTwoFactor: (v: boolean) => void;
  clear: () => void;
}

const STORAGE_KEY = 'docflow-auth';

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      email: null,
      tenantSlug: null,
      tenantName: null,
      accessToken: null,
      refreshToken: null,
      requiresTwoFactor: false,

      setSession: (s) =>
        set((prev) => {
          const next = { ...prev, ...s };
          // Mirror the access token into a non-HTTPOnly cookie so edge
          // middleware can enforce the auth gate (it can't read
          // localStorage). The cookie value is the raw JWT — readable
          // from the client anyway, so no extra exposure surface.
          if (typeof document !== 'undefined') {
            if (next.accessToken) {
              document.cookie = `${STORAGE_KEY}=${encodeURIComponent(
                next.accessToken,
              )}; Path=/; Max-Age=2592000; SameSite=Lax`;
            } else {
              document.cookie = `${STORAGE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
            }
          }
          return next;
        }),
      setRequiresTwoFactor: (v) => set({ requiresTwoFactor: v }),
      clear: () =>
        set(() => {
          if (typeof document !== 'undefined') {
            document.cookie = `${STORAGE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
          }
          return {
            email: null,
            tenantSlug: null,
            tenantName: null,
            accessToken: null,
            refreshToken: null,
            requiresTwoFactor: false,
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        email: state.email,
        tenantSlug: state.tenantSlug,
        tenantName: state.tenantName,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        requiresTwoFactor: state.requiresTwoFactor,
      }),
      // Purge poisoned sessions on load. Two failure modes are guarded:
      //  1. The earlier offline stub persisted a fake `mock-access-token` —
      //     anything that isn't a well-formed 3-segment JWT is cleared.
      //  2. A real JWT may have already expired (the access token is only
      //     valid for 15 minutes). If the user comes back after the expiry
      //     window, the next request would 401 before refresh can run, so
      //     we proactively clear the expired token here and let the auth
      //     gate redirect them to /login.
      // In both cases the cookie mirror is cleared so edge middleware
      // also sees the session as logged-out.
      onRehydrateStorage: () => (state) => {
        const t = state?.accessToken;
        const poisoned = t && !looksLikeJwt(t);
        const expired = t && looksLikeJwt(t) && isJwtExpired(t);
        if (poisoned || expired) {
          state?.clear();
          if (typeof document !== 'undefined') {
            document.cookie = `${STORAGE_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
          }
        }
      },
    },
  ),
);
