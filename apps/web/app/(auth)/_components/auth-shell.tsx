'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/_components/ui/button';
import { Input } from '@/_components/ui/input';
import { BrandPanel } from './brand-header';

export { BrandHeader, BrandPanel } from './brand-header';

/**
 * AuthShell — premium split-screen shell for every (auth) page.
 *
 * Desktop (lg+): brand panel on the left, form card on the right.
 * Mobile/tablet:  centered form card with decorative orbs.
 *
 * Mesh background, blurred gradient orbs (animated), grid overlay.
 */
export function AuthShell({
  children,
  maxWidth = 'max-w-md',
  withBrandPanel = true,
}: {
  children: ReactNode;
  maxWidth?: string;
  withBrandPanel?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      className="min-h-screen bg-mesh bg-grid relative overflow-hidden flex"
      data-mounted={mounted}
    >
      {/* Decorative gradient orbs */}
      <div
        aria-hidden="true"
        className="absolute top-1/4 -left-20 w-[28rem] h-[28rem] rounded-full blur-3xl pointer-events-none animate-orb"
        style={{ background: 'var(--mesh-1)' }}
      />
      <div
        aria-hidden="true"
        className="absolute bottom-1/4 -right-20 w-[30rem] h-[30rem] rounded-full blur-3xl pointer-events-none animate-orb"
        style={{ background: 'var(--mesh-2)', animationDelay: '4s' }}
      />
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] rounded-full blur-3xl pointer-events-none opacity-40"
        style={{ background: 'var(--mesh-3)' }}
      />

      {/* Optional left brand panel */}
      {withBrandPanel && <BrandPanel />}

      {/* Form column */}
      <main className="flex-1 min-w-0 flex items-center justify-center p-4 sm:p-6 md:p-10 relative z-10">
        <div className={`w-full ${maxWidth} relative z-10`}>{children}</div>
      </main>
    </div>
  );
}

/**
 * AuthCard — frosted card surface that wraps the actual form.
 */
export function AuthCard({
  children,
  title,
  subtitle,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <section
      className="glass-card p-6 sm:p-8 animate-pop"
      aria-labelledby={title ? 'auth-card-title' : undefined}
    >
      {title && (
        <header className="mb-6">
          <h2
            id="auth-card-title"
            className="text-lg sm:text-xl font-bold tracking-tight"
            style={{ color: 'var(--text)' }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs sm:text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {subtitle}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Inline error banner — used by every form to surface server-side errors.
 */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      aria-live="polite"
      className="rounded-xl px-3.5 py-3 text-sm flex items-start gap-2.5 animate-in"
      style={{
        background: 'rgba(248, 113, 113, 0.08)',
        border: '1px solid rgba(248, 113, 113, 0.25)',
        color: 'var(--danger-fg)',
      }}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: 'var(--danger)' }}
      />
      <span className="flex-1">{message}</span>
    </div>
  );
}

/**
 * SubmitButton — primary CTA built on the shared Button primitive.
 */
export function SubmitButton({
  loading,
  children,
  loadingLabel,
}: {
  loading: boolean;
  children: ReactNode;
  loadingLabel: string;
}) {
  return (
    <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} loadingLabel={loadingLabel}>
      {children}
    </Button>
  );
}

/**
 * FieldGroup — wrapper that delegates to the shared Input primitive.
 * Kept as a thin facade so existing call sites stay readable.
 */
type FieldGroupProps = Omit<React.ComponentProps<typeof Input>, 'size'>;
export function FieldGroup(props: FieldGroupProps) {
  return <Input {...props} />;
}

/**
 * CheckboxField — accessible checkbox + label pair.
 */
export function CheckboxField({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="inline-flex items-start gap-2.5 text-sm cursor-pointer select-none leading-snug"
      style={{ color: 'var(--text-muted)' }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer"
        style={{
          accentColor: 'var(--accent)',
          borderColor: 'var(--border-strong)',
        }}
      />
      <span>{children}</span>
    </label>
  );
}

/**
 * AuthFooter — tiny legal/secondary CTA row, used below the card.
 */
export function AuthFooter({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-center text-[11px] mt-6 leading-relaxed"
      style={{ color: 'var(--text-subtle)' }}
    >
      {children}
    </p>
  );
}

export function AuthTermsFooter() {
  return (
    <AuthFooter>
      Ao continuar concorda com os{' '}
      <Link
        href="/legal/terms"
        className="underline underline-offset-2 hover:opacity-80 transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        Termos
      </Link>{' '}
      e a{' '}
      <Link
        href="/legal/privacy"
        className="underline underline-offset-2 hover:opacity-80 transition-opacity"
        style={{ color: 'var(--text-muted)' }}
      >
        Política de Privacidade
      </Link>
      .
    </AuthFooter>
  );
}

/**
 * useFormSubmit — small hook that wraps handleSubmit boilerplate.
 */
export function useFormSubmit<T>(
  fn: () => Promise<T>,
): {
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  error: string | null;
  reset: () => void;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message ?? 'Ocorreu um erro inesperado.');
    } finally {
      setLoading(false);
    }
  };

  return { onSubmit, loading, error, reset: () => setError(null) };
}