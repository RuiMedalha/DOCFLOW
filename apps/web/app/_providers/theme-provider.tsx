'use client';

/**
 * DocFlow — Theme provider (next-themes)
 *
 * Wires next-themes to the <html data-theme> attribute that the design
 * tokens in globals.css key off. Class mode disabled — we use attribute
 * mode so the CSS variables flip correctly on every element.
 */

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
