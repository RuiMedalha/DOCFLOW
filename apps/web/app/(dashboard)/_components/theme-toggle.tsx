'use client';

/**
 * ThemeToggle — sun/moon button bound to next-themes.
 *
 * Animates the icon swap with a quick rotate/fade.
 */

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Alternar tema"
        className={`btn-ghost p-2 ${className}`}
        disabled
      >
        <Moon size={16} />
      </button>
    );
  }

  const isDark = resolvedTheme === 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={`btn-ghost p-2 ${className}`}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
    >
      <span key={isDark ? 'sun' : 'moon'} className="inline-flex animate-pop">
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </span>
    </button>
  );
}