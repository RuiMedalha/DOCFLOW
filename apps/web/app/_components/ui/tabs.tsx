'use client';

/**
 * Tabs — accessible tab list with keyboard arrow navigation.
 *
 * Controlled: caller owns `value` + `onChange`. Renders a role="tablist"
 * with roving focus and aria-selected wiring.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Tabs({
  items,
  value,
  onChange,
  className = '',
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + dir + items.length) % items.length;
    const item = items[next];
    if (item) {
      onChange(item.value);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="tablist"
      className={['flex items-center gap-1 border-b', className].filter(Boolean).join(' ')}
      style={{ borderColor: 'var(--border)' }}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px"
            style={{
              color: active ? 'var(--text)' : 'var(--text-muted)',
              borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' && (
              <span
                className="text-xs tabular-nums px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--hover)', color: 'var(--text-muted)' }}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
