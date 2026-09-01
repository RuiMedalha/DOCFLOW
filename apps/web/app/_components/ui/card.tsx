'use client';

/**
 * Card — surface primitive.
 *
 * Variants: solid | glass | hover
 * Padding:  none | sm | md | lg
 */

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

type Variant = 'solid' | 'glass' | 'hover' | 'default';
type Padding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
  padding?: Padding;
  as?: 'div' | 'section' | 'article';
  children?: ReactNode;
}

const PADDING_CLASS: Record<Padding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

const VARIANT_CLASS: Record<Variant, string> = {
  default: 'card',
  solid: 'card card-solid',
  glass: 'glass-card',
  hover: 'card-hover',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'default', padding = 'md', as = 'div', className = '', children, ...rest },
  ref,
) {
  const Tag = as as 'div';
  const cls = [
    VARIANT_CLASS[variant],
    PADDING_CLASS[padding],
    'animate-in',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tag ref={ref as never} className={cls} {...rest}>
      {children}
    </Tag>
  );
});

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={['mb-4', className].join(' ')}>{children}</div>;
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={['text-base font-semibold tracking-tight', className].join(' ')} style={{ color: 'var(--text)' }}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={['text-xs mt-1', className].join(' ')} style={{ color: 'var(--text-subtle)' }}>{children}</p>;
}
