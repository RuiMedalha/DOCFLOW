'use client';

/**
 * DocFlow — Dashboard query hooks (TanStack Query).
 *
 * Encapsulates the user + tenant fetch so layout components stay clean
 * and every component reuses the same cache key (and therefore the same
 * network round-trip).
 */

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from './auth-store';

export interface UserInfo {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  nif?: string;
}

/**
 * Returns the user info currently in the auth store. Hydrated synchronously
 * from localStorage by zustand persist — no refetch needed.
 */
export function useUser(): UserInfo | null {
  const { email, accessToken } = useAuthStore();
  if (!email || !accessToken) return null;
  // Until the backend ships /api/auth/me we synthesize a record from the
  // store so the layout can render the user menu without a network call.
  return {
    id: email,
    email,
    name: email.split('@')[0] ?? email,
    role: 'Admin',
    tenantId: 'pending',
  };
}

/**
 * Returns the tenant info currently in the auth store.
 */
export function useTenant(): TenantInfo | null {
  const { tenantSlug, tenantName } = useAuthStore();
  if (!tenantSlug) return null;
  return {
    id: tenantSlug,
    slug: tenantSlug,
    name: tenantName ?? tenantSlug,
  };
}

/**
 * Fetches a list of notifications for the bell icon. Polled every 60 s.
 * Returns an empty array if the user is not signed in.
 */
export function useNotifications() {
  const { accessToken } = useAuthStore();
  return useQuery({
    enabled: Boolean(accessToken),
    queryKey: ['notifications'],
    queryFn: async (): Promise<Array<{ id: string; title: string; body?: string; severity?: string; href?: string }>> => {
      if (!accessToken) return [];
      // Stubbed until the backend /notifications endpoint is wired.
      // The UI degrades gracefully when the array is empty.
      return [];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
