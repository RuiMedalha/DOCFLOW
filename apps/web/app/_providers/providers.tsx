'use client';

/**
 * DocFlow — Combined client providers.
 *
 * Order matters: ThemeProvider (next-themes) → QueryProvider (TanStack
 * Query). Auth state lives in a zustand store (useAuthStore) so it does
 * not need a React provider here.
 */

import { QueryProvider } from './query-provider';
import { ThemeProvider } from './theme-provider';
import { Toaster } from '@/_components/ui';
import type { ReactNode } from 'react';

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        {children}
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
