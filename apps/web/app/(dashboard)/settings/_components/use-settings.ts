'use client';

/**
 * DocFlow — Settings query hooks (local).
 *
 * Provides the exact hook shapes our panels use; centralizes the auth
 * header + unwrap via the shared `http` client.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../../../_lib/http';
import type {
  Integration,
  IntegrationAuthorizeResult,
  IntegrationConfigureInput,
  IntegrationTestResult,
  IntegrationProvider,
} from '../_lib/types';

export const settingsKeys = {
  all: ['settings'] as const,
  integrations: () => ['settings', 'integrations'] as const,
  integration: (provider: string) => ['settings', 'integrations', provider] as const,
};

export function useIntegrations() {
  return useQuery<Integration[]>({
    queryKey: settingsKeys.integrations(),
    queryFn: () => http.get<Integration[]>('/integrations'),
    staleTime: 60_000,
  });
}

export function useTestIntegration(provider: string | null) {
  return useQuery<IntegrationTestResult | null>({
    queryKey: settingsKeys.integration(provider ?? ''),
    queryFn: async () => {
      if (!provider) return null;
      return http.get<IntegrationTestResult>(`/integrations/${provider}/test`);
    },
    enabled: !!provider,
  });
}

export function useConfigureIntegration() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean },
    Error,
    { provider: string; credentials: IntegrationConfigureInput }
  >({
    mutationFn: async ({ provider, credentials }) =>
      http.post<{ ok: boolean }>(`/integrations/${provider}/configure`, credentials),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.integrations() }),
  });
}

export function useSyncIntegration() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean; synced?: number }, Error, { provider: string }>({
    mutationFn: async ({ provider }) =>
      http.post<{ ok: boolean; synced?: number }>(`/integrations/${provider}/sync`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.integrations() }),
  });
}

export function useAuthorizeIntegration() {
  return useMutation<IntegrationAuthorizeResult, Error, { provider: IntegrationProvider; redirectUri: string }>({
    mutationFn: async ({ provider, redirectUri }) =>
      http.post<IntegrationAuthorizeResult>(`/integrations/${provider}/authorize`, { redirectUri }),
  });
}