'use client';

/**
 * Badge — small status pill.
 *
 * Tones: sky | emerald | amber | violet | rose | neutral
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

export type BadgeTone = 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'neutral';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  sky: 'badge-sky',
  emerald: 'badge-emerald',
  amber: 'badge-amber',
  violet: 'badge-violet',
  rose: 'badge-rose',
  neutral: 'badge-neutral',
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', icon, className = '', children, ...rest },
  ref,
) {
  return (
    <span ref={ref} className={[TONE_CLASS[tone], className].filter(Boolean).join(' ')} {...rest}>
      {icon}
      {children}
    </span>
  );
});
