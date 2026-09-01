'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ShieldCheck,
  Copy,
  CheckCircle2,
  QrCode,
} from 'lucide-react';

import { apiClient } from '../../../_lib/api-client';
import { useAuthStore } from '../../../_lib/auth-store';
import {
  AuthCard,
  AuthShell,
  BrandHeader,
  FieldGroup,
  FormError,
  SubmitButton,
  useFormSubmit,
} from '../../_components/auth-shell';

/**
 * Renders the otpauth:// URI as a visual QR-code-like grid.
 * Backend will later return a real data: URL from a QR service.
 */
function QrPreview({ value }: { value: string }) {
  const cells = useMemo(() => {
    const grid: boolean[][] = [];
    let seed = 0;
    for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
    for (let r = 0; r < 25; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < 25; c++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        row.push(((seed >> 16) & 1) === 1);
      }
      grid.push(row);
    }
    const stamp = (r0: number, c0: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const onEdge = r === 0 || r === 6 || c === 0 || c === 6;
          const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[r0 + r][c0 + c] = onEdge || inner;
        }
      }
    };
    stamp(0, 0);
    stamp(0, 18);
    stamp(18, 0);
    return grid;
  }, [value]);

  return (
    <div
      className="rounded-2xl p-4 inline-flex mx-auto transition-transform duration-300 hover:scale-[1.02]"
      style={{
        background: '#ffffff',
        boxShadow: 'var(--shadow-md)',
      }}
      role="img"
      aria-label="QR code para configurar a aplicação autenticadora"
    >
      <svg
        viewBox="0 0 25 25"
        width="192"
        height="192"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width="25" height="25" fill="#ffffff" />
        {cells.map((row, r) =>
          row.map((on, c) =>
            on ? (
              <rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill="#0f172a" />
            ) : null,
          ),
        )}
      </svg>
    </div>
  );
}

export default function TwoFactorSetupPage() {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  const setupQuery = useQuery({
    queryKey: ['2fa', 'setup'],
    queryFn: () => apiClient.setup2fa({ code: '__init__' } as any),
    enabled: Boolean(accessToken),
  });

  const otpauthUrl =
    (setupQuery.data as any)?.otpauthUrl ??
    'otpauth://totp/DocFlow:placeholder?secret=PLACEHOLDER&issuer=DocFlow';
  const secret = (setupQuery.data as any)?.secret ?? 'PLACEHOLDER';

  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  const verifyMutation = useMutation({
    mutationFn: () => apiClient.setup2fa({ code }),
    onSuccess: () => router.push('/dashboard?2fa=enabled'),
  });

  const codeError =
    code && !/^\d{6}$/.test(code) ? 'O código tem 6 dígitos.' : null;

  const { onSubmit, loading } = useFormSubmit(async () => {
    if (codeError) throw new Error('Verifique o código inserido.');
    await verifyMutation.mutateAsync();
  });

  const errorMsg = (verifyMutation.error as Error | undefined)?.message ?? null;

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <AuthShell withBrandPanel={false}>
      <div className="max-w-md mx-auto">
        <BrandHeader
          title="Ativar 2FA"
          subtitle="Reforce a segurança da sua conta com autenticação em dois fatores."
        />

        <AuthCard
          title="Aplicação autenticadora"
          subtitle="Leia o QR code com Google Authenticator, 1Password, Authy ou similar."
        >
          <div className="space-y-6">
            <section aria-labelledby="step-1">
              <h3
                id="step-1"
                className="text-sm font-semibold mb-3 flex items-center gap-2"
                style={{ color: 'var(--text)' }}
              >
                <StepBadge n={1} />
                Ler QR code
              </h3>
              <div className="text-center">
                <QrPreview value={otpauthUrl} />
                <p
                  className="mt-3 text-xs inline-flex items-center gap-1.5"
                  style={{ color: 'var(--text-subtle)' }}
                >
                  <QrCode size={12} aria-hidden="true" />
                  Não consegue ler? Use o código manual abaixo.
                </p>
              </div>
            </section>

            <section aria-labelledby="step-2">
              <h3
                id="step-2"
                className="text-sm font-semibold mb-2 flex items-center gap-2"
                style={{ color: 'var(--text)' }}
              >
                <StepBadge n={2} />
                Código manual
              </h3>
              <div
                className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border-strong)',
                }}
              >
                <code
                  className="flex-1 text-sm font-mono tabular-nums break-all"
                  style={{ color: 'var(--text)' }}
                >
                  {secret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="btn-ghost p-1.5"
                  aria-label="Copiar código manual"
                >
                  {copied ? (
                    <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
            </section>

            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              <h3
                id="step-3"
                className="text-sm font-semibold mb-2 flex items-center gap-2"
                style={{ color: 'var(--text)' }}
              >
                <StepBadge n={3} />
                Confirmar com código de teste
              </h3>
              <FieldGroup
                id="code"
                label="Código de 6 dígitos"
                value={code}
                onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                inputMode="numeric"
                pattern="\d{6}"
                autoComplete="one-time-code"
                required
                error={codeError ?? undefined}
              />
              <FormError message={errorMsg} />
              <SubmitButton loading={loading} loadingLabel="A confirmar…">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Ativar 2FA</span>
                <ArrowRight size={16} aria-hidden="true" />
              </SubmitButton>
            </form>
          </div>

          <p
            className="mt-6 text-center text-xs"
            style={{ color: 'var(--text-subtle)' }}
          >
            <Link
              href="/dashboard"
              className="underline underline-offset-2 transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-muted)' }}
            >
              Configurar mais tarde
            </Link>
          </p>
        </AuthCard>
      </div>
    </AuthShell>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
      style={{
        background: 'var(--brand-gradient)',
        color: '#020617',
        boxShadow: '0 4px 12px -2px rgba(56, 189, 248, 0.40)',
      }}
    >
      {n}
    </span>
  );
}