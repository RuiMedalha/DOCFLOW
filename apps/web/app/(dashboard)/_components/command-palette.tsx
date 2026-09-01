'use client';

/**
 * CommandPalette â€” Cmd/Ctrl+K global search + navigation.
 *
 * Modal that opens on Cmd/Ctrl+K or via the trigger button. Pattern matches
 * Linear / Vercel â€” search-as-you-type with arrow key navigation.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  X,
  FileText,
  Users,
  Landmark,
  Wallet,
  Settings,
  HelpCircle,
  LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';
import { NAV_ITEMS, type NavItem as NavItemType } from '../_lib/nav-items';

interface PaletteEntry {
  href: string;
  label: string;
  group: 'NavegaÃ§Ã£o' | 'AcÃ§Ãµes';
  Icon: LucideIcon;
  keywords?: string[];
}

function buildEntries(): PaletteEntry[] {
  const navEntries: PaletteEntry[] = NAV_ITEMS.map((item: NavItemType) => ({
    href: item.href,
    label: item.label,
    group: 'NavegaÃ§Ã£o' as const,
    Icon: item.Icon,
  }));

  // A few quick actions (placeholder â€” real ones come when actions land).
  const actionEntries: PaletteEntry[] = [
    { href: '/documents?new=1', label: 'Novo documento', group: 'AcÃ§Ãµes' as const, Icon: FileText, keywords: ['upload', 'criar'] },
    { href: '/crm?new=1', label: 'Nova entidade', group: 'AcÃ§Ãµes' as const, Icon: Users, keywords: ['cliente', 'fornecedor'] },
    { href: '/banking?new=1', label: 'Nova conta', group: 'AcÃ§Ãµes' as const, Icon: Landmark, keywords: ['banco', 'conta'] },
    { href: '/payments?new=1', label: 'Novo pagamento', group: 'AcÃ§Ãµes' as const, Icon: Wallet, keywords: ['pagar', 'criar'] },
    { href: '/settings', label: 'DefiniÃ§Ãµes', group: 'NavegaÃ§Ã£o' as const, Icon: Settings },
    { href: '/help', label: 'Ajuda', group: 'NavegaÃ§Ã£o' as const, Icon: HelpCircle },
  ];

  return [...navEntries, ...actionEntries];
}

const ALL_ENTRIES = buildEntries();

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
    }
  }, [open]);

  const filtered = q.trim()
    ? ALL_ENTRIES.filter((e) => {
        const text = `${e.label} ${e.keywords?.join(' ') ?? ''}`.toLowerCase();
        return text.includes(q.trim().toLowerCase());
      })
    : ALL_ENTRIES;

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[active]) {
      e.preventDefault();
      go(filtered[active].href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden md:flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-all w-56 lg:w-72 hover:border-sky-400/40"
        style={{
          borderColor: 'var(--border-strong)',
          color: 'var(--text-muted)',
          background: 'var(--input-bg)',
        }}
      >
        <Search size={15} aria-hidden="true" />
        <span className="flex-1 text-left">Pesquisarâ€¦</span>
        <kbd className="kbd">âŒ˜K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden btn-ghost p-2"
        aria-label="Pesquisar"
      >
        <Search size={18} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh] sm:pt-[14vh] px-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Paleta de comandos"
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in" aria-hidden="true" />
          <div
            className="relative w-full max-w-lg glass-card overflow-hidden animate-pop"
            style={{
              background: 'var(--bg-card-solid)',
              boxShadow: 'var(--shadow-xl)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center gap-2 px-4 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <Search size={18} style={{ color: 'var(--text-subtle)' }} aria-hidden="true" />
              <input
                autoFocus
                className="flex-1 bg-transparent border-0 outline-none py-3.5 text-sm focus:ring-0"
                style={{ color: 'var(--text)' }}
                placeholder="Pesquisar pÃ¡ginas e aÃ§Ãµesâ€¦"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                aria-label="Pesquisar"
              />
              {q && (
                <button
                  type="button"
                  aria-label="Limpar pesquisa"
                  className="btn-ghost p-1"
                  onClick={() => setQ('')}
                >
                  <X size={16} />
                </button>
              )}
              <kbd className="kbd hidden sm:inline-flex">ESC</kbd>
            </div>

            <div className="max-h-[55vh] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--text-subtle)' }}>
                  Sem resultados para â€œ{q}â€
                </div>
              ) : (
                <ul role="listbox">
                  {filtered.map((entry, i) => {
                    const { Icon } = entry;
                    const isActive = i === active;
                    return (
                      <li key={`${entry.group}-${entry.href}`}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors"
                          style={{
                            background: isActive ? 'var(--hover)' : 'transparent',
                            borderLeft: isActive
                              ? '2px solid var(--accent)'
                              : '2px solid transparent',
                          }}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(entry.href)}
                        >
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border"
                            style={{
                              borderColor: 'var(--border)',
                              background: 'var(--hover)',
                              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            <Icon size={16} aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm font-medium truncate"
                              style={{ color: 'var(--text)' }}
                            >
                              {entry.label}
                            </div>
                            <div
                              className="text-[11px] truncate mt-0.5"
                              style={{ color: 'var(--text-subtle)' }}
                            >
                              {entry.group}
                            </div>
                          </div>
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="text-[10px] font-mono flex-shrink-0"
                              style={{ color: 'var(--text-subtle)' }}
                            >
                              â†µ
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!q && (
                <div
                  className="m-2 p-3 rounded-lg flex items-center gap-2 text-xs"
                  style={{
                    background: 'var(--hover)',
                    color: 'var(--text-subtle)',
                  }}
                >
                  <LayoutDashboard size={14} aria-hidden="true" />
                  <span>
                    Prima{' '}
                    <kbd className="kbd mx-0.5">â†‘â†“</kbd> para navegar,{' '}
                    <kbd className="kbd mx-0.5">â†µ</kbd> para abrir.
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
