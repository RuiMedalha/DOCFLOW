import type { ReactNode } from 'react';

/**
 * (auth) route group layout — public, centered, mesh background.
 *
 * QueryClient and ThemeProvider are already mounted by the root layout
 * (app/layout.tsx) so this layout is a passthrough that simply provides
 * the route-group semantics for /login, /register, etc.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}