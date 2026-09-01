'use client';

/**
 * (dashboard) route group layout.
 *
 * Wraps every authenticated page with:
 *   - <AuthGate>: client-side token check + splash.
 *   - Sidebar (left) with nav links + brand block + tenant chip.
 *   - Topbar with breadcrumb, command palette, theme toggle, notifications,
 *     user menu, and the Copilot trigger.
 *   - Main scroll area with the route's children.
 *
 * The right-docked Copilot panel is mounted as a child of <CopilotTrigger>
 * so it can be opened from any page. The aria-live skip link targets
 * #main-content.
 */

import type { ReactNode } from 'react';
import { AuthGate } from './_components/auth-gate';
import { Sidebar } from './_components/sidebar';
import { Topbar } from './_components/topbar';
import { CopilotTrigger } from './_components/copilot-trigger';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <a href="#main-content" className="skip-link">
        Saltar para o conteúdo principal
      </a>
      <div className="min-h-screen bg-mesh bg-grid flex flex-col md:flex-row">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Topbar />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 min-w-0 overflow-auto focus:outline-none"
          >
            <div className="p-4 md:p-8 max-w-7xl mx-auto animate-in">{children}</div>
          </main>
          <CopilotTrigger />
        </div>
      </div>
    </AuthGate>
  );
}