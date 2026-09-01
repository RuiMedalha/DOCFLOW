'use client';

/**
 * Sidebar — modern app shell.
 *
 * Desktop (md+): collapsible sidebar with section grouping + active gradient.
 * Mobile (<md):  full-height drawer with overlay, toggled via the topbar's
 *                hamburger button. Body scroll is locked while open.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, Building2, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useSidebarStore } from '@/_lib/sidebar-store';
import { useTenant } from '@/_lib/use-dashboard-queries';
import { NAV_ITEMS } from '../_lib/nav-items';

const SIZE_CLASSES = {
  expanded: 'md:w-[272px]',
  collapsed: 'md:w-[78px]',
};

export function Sidebar() {
  const pathname = usePathname();
  const tenant = useTenant();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebarStore();

  const showLabel = !collapsed;
  const widthClass = collapsed ? SIZE_CLASSES.collapsed : SIZE_CLASSES.expanded;

  // Group items by section for the desktop sidebar
  const mainItems = NAV_ITEMS.filter((i) => i.section !== 'config');
  const configItems = NAV_ITEMS.filter((i) => i.section === 'config');

  return (
    <>
      {/* Mobile overlay */}
      <div
        aria-hidden="true"
        onClick={closeMobile}
        className={[
          'fixed inset-0 z-40 md:hidden bg-black/60 backdrop-blur-sm transition-opacity duration-200',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      <aside
        aria-label="Navegação principal"
        className={[
          'fixed inset-y-0 left-0 z-50 md:relative md:inset-auto md:z-30',
          'flex flex-col w-[280px] md:w-auto flex-shrink-0',
          widthClass,
          'transition-transform duration-300 md:transition-[width]',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        <div
          className="flex flex-col h-full glass md:border-r"
          style={{ width: 'inherit' }}
        >
          {/* Brand block */}
          <div className="p-4 md:p-5 pb-3 md:pb-4 flex items-center justify-between">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 min-w-0 group"
              onClick={closeMobile}
            >
              <div
                aria-hidden="true"
                className="w-10 h-10 rounded-2xl brand-mark flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-105"
              >
                <Sparkles size={20} className="text-slate-950" />
              </div>
              {showLabel && (
                <div className="min-w-0">
                  <div
                    className="font-bold text-lg tracking-tight truncate"
                    style={{ color: 'var(--text)' }}
                  >
                    DocFlow
                  </div>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-[0.18em] truncate"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    Document Intelligence
                  </div>
                </div>
              )}
            </Link>

            {/* Mobile close */}
            <button
              type="button"
              onClick={closeMobile}
              className="md:hidden btn-ghost p-1.5"
              aria-label="Fechar menu"
            >
              <X size={18} />
            </button>

            {/* Desktop collapse toggle */}
            <button
              type="button"
              onClick={toggle}
              className="hidden md:inline-flex btn-ghost p-1.5 flex-shrink-0"
              aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
              title={collapsed ? 'Expandir' : 'Recolher'}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          {/* Tenant chip */}
          {showLabel && (
            <div className="px-4 mb-3">
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-xl border transition-colors"
                style={{ borderColor: 'var(--border)', background: 'var(--hover)' }}
              >
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md"
                  style={{ background: 'var(--brand-gradient-soft)', color: 'var(--accent)' }}
                >
                  <Building2 size={12} />
                </span>
                <span
                  className="text-xs truncate font-medium flex-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {tenant?.name ?? 'Sem organização'}
                </span>
              </div>
            </div>
          )}

          {/* Nav */}
          <nav className="flex-1 px-3 space-y-1 overflow-y-auto" aria-label="Secções">
            <NavGroup items={mainItems} pathname={pathname} showLabel={showLabel} closeMobile={closeMobile} />
            {showLabel && configItems.length > 0 && (
              <>
                <div className="pt-4 pb-1 px-3">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                    style={{ color: 'var(--text-subtle)' }}
                  >
                    Configuração
                  </span>
                </div>
                <NavGroup items={configItems} pathname={pathname} showLabel={showLabel} closeMobile={closeMobile} />
              </>
            )}
          </nav>

          {/* Footer */}
          <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <div
              className={[
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs',
                showLabel ? '' : 'justify-center',
              ].join(' ')}
              style={{ color: 'var(--text-subtle)' }}
            >
              <div className="relative flex-shrink-0">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse-glow" />
              </div>
              {showLabel && (
                <span className="truncate">Sistema operacional</span>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function NavGroup({
  items,
  pathname,
  showLabel,
  closeMobile,
}: {
  items: typeof NAV_ITEMS;
  pathname: string;
  showLabel: boolean;
  closeMobile: () => void;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
        const { Icon } = item;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={closeMobile}
              title={!showLabel ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
              className={[
                active ? 'nav-item-active' : 'nav-item-idle',
                !showLabel ? 'justify-center px-2' : '',
              ].join(' ')}
            >
              <Icon
                size={18}
                className="flex-shrink-0 transition-colors"
                style={active ? { color: 'var(--accent)' } : undefined}
                aria-hidden="true"
              />
              {showLabel && <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}