'use client';

/**
 * Topbar — sticky app bar with breadcrumb, command palette, theme toggle,
 * notifications, and user menu.
 *
 * Mobile: hamburger triggers the sidebar drawer; brand shown inline.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, ChevronRight } from 'lucide-react';
import { useSidebarStore } from '@/_lib/sidebar-store';
import { CommandPalette } from './command-palette';
import { ThemeToggle } from './theme-toggle';
import { NotificationBell } from './notification-bell';
import { UserMenu } from './user-menu';
import { NAV_BY_HREF } from '../_lib/nav-items';

function buildCrumbs(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: { href: string; label: string }[] = [
    { href: '/dashboard', label: 'Início' },
  ];
  let acc = '';
  for (const seg of segments) {
    acc += `/${seg}`;
    // On /dashboard itself the loop would append a second crumb with the same
    // href as the "Início" root, producing duplicate React keys. Skip it.
    if (acc === '/dashboard') continue;
    if (NAV_BY_HREF[acc]) {
      crumbs.push({ href: acc, label: NAV_BY_HREF[acc].label });
    } else {
      const label = seg.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      crumbs.push({ href: acc, label });
    }
  }
  return crumbs;
}

export function Topbar() {
  const pathname = usePathname();
  const toggleMobile = useSidebarStore((s) => s.toggleMobile);
  const crumbs = buildCrumbs(pathname);

  return (
    <header
      className="sticky top-0 z-40 flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-6 py-3 border-b"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--bg) 80%, transparent)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
      }}
    >
      {/* Mobile menu + brand */}
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          aria-label="Abrir menu"
          onClick={toggleMobile}
          className="btn-ghost p-2"
        >
          <Menu size={18} />
        </button>
        <Link href="/dashboard" className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-base truncate" style={{ color: 'var(--text)' }}>
            DocFlow
          </span>
        </Link>
      </div>

      {/* Desktop breadcrumb */}
      <nav aria-label="Breadcrumb" className="hidden md:block min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-sm flex-wrap">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${c.href}-${i}`} className="flex items-center gap-1.5 min-w-0">
                {i > 0 && (
                  <ChevronRight
                    size={12}
                    aria-hidden="true"
                    style={{ color: 'var(--text-subtle)' }}
                  />
                )}
                {last ? (
                  <span
                    className="font-semibold truncate max-w-[260px]"
                    style={{ color: 'var(--text)' }}
                    aria-current="page"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="truncate max-w-[200px] transition-colors hover:underline"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Right cluster */}
      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 ml-auto">
        <CommandPalette />
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}