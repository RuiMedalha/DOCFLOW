'use client';

/**
 * Skeleton — loading placeholder.
 *
 * Renders a shimmering block that respects the design tokens. Use the
 * `SkeletonTable` helper for tabular loading states.
 */

import type { HTMLAttributes } from 'react';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Tailwind height utility, e.g. "h-4". Defaults to "h-4". */
  height?: string;
  /** Tailwind width utility, e.g. "w-24" or "w-full". Defaults to "w-full". */
  width?: string;
  circle?: boolean;
}

export function Skeleton({
  height = 'h-4',
  width = 'w-full',
  circle = false,
  className = '',
  ...rest
}: SkeletonProps) {
  const cls = [
    'skeleton',
    height,
    width,
    circle ? 'rounded-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return <div aria-hidden="true" className={cls} {...rest} />;
}

/** Rows x cols skeleton grid for table loading states. */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="A carregar…">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton
              key={c}
              height="h-5"
              width={c === 0 ? 'w-8' : c === 1 ? 'w-48' : 'w-24'}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
