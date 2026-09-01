'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Lock, Eye, EyeOff, KeyRound, Check, X, ShieldAlert } from 'lucide-react';

import { apiClient } from '../../_lib/api-client';
import {
  AuthCard,
  AuthShell,
  BrandHeader,
  FieldGroup,
  FormError,
  SubmitButton,
  useFormSubmit,
} from '../_components/auth-shell';

function ResetPasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [touched, setTouched] = useState({ password: false, confirm: false });

  const resetMutation = useMutation({
    mutationFn: () => apiClient.resetPassword({ token, password }),
    onSuccess: () => router.push('/login?reset=ok'),
  });

  const passwordError =
    touched.password && password.length < 8
      ? 'A password deve ter pelo menos 8 caracteres.'
      : null;
  const confirmError =
    touched.confirm && password !== confirm
      ? 'As passwords não coincidem.'
      : null;
  const tokenError = !token ? 'Link inválido ou expirado.' : null;

  const passwordStrength = useMemo(() => {
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  }, [password]);

  const requirements = useMemo(() => {
    return [
      { ok: password.length >= 8, label: 'Pelo menos 8 caracteres' },
      { ok: /[A-Z]/.test(password), label: 'Uma letra maiúscula' },
      { ok: /[0-9]/.test(password), label: 'Um número' },
      { ok: /[^A-Za-z0-9]/.test(password), label: 'Um símbolo' },
    ];
  }, [password]);

  const { onSubmit, loading } = useFormSubmit(async () => {
    setTouched({ password: true, confirm: true });
    if (tokenError) throw new Error(tokenError);
    if (passwordError || confirmError) {
      throw new Error('Verifique os campos assinalados.');
    }
    await resetMutation.mutateAsync();
  });

  const errorMsg = (resetMutation.error as Error | undefined)?.message ?? null;
  const showError = errorMsg ?? (tokenError && touched.password ? tokenError : null);

  const strengthColor = [
    'var(--danger)',
    'var(--danger)',
    'var(--warning)',
    'var(--accent)',
    'var(--success)',
  ][passwordStrength];

  return (
    <AuthShell withBrandPanel={false}>
      <div className="max-w-md mx-auto">
        <BrandHeader title="Definir nova password" subtitle="Escolha uma password forte que ainda não tenha utilizado." />

        <AuthCard
          title="Nova password"
          subtitle="A password anterior deixará de funcionar imediatamente."
        >
          {tokenError && (
            <div
              className="rounded-xl px-3.5 py-3 text-sm flex items-start gap-2.5 mb-5 animate-in"
              style={{
                background: 'rgba(251, 191, 36, 0.08)',
                border: '1px solid rgba(251, 191, 36, 0.25)',
                color: 'var(--warning-fg)',
              }}
              role="alert"
            >
              <ShieldAlert size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span className="flex-1">{tokenError}</span>
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FieldGroup
              id="password"
              label="Nova password"
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
              minLength={8}
              leftIcon={<Lock size={16} />}
              error={passwordError ?? undefined}
              description="Mínimo 8 caracteres, com letra maiúscula, número e símbolo."
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              rightSlot={
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? 'Ocultar password' : 'Mostrar password'}
                  aria-pressed={showPwd}
                  className="btn-ghost p-1.5"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />

            {password.length > 0 && (
              <div className="space-y-2 -mt-1">
                <div className="flex items-center gap-3" role="status" aria-live="polite">
                  <div
                    className="h-1.5 flex-1 rounded-full overflow-hidden"
                    style={{ background: 'var(--border)' }}
                    aria-hidden="true"
                  >
                    <div
                      className="h-full transition-all duration-500"
                      style={{
                        width: `${(passwordStrength / 4) * 100}%`,
                        background: strengthColor,
                      }}
                    />
                  </div>
                </div>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {requirements.map((r, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      {r.ok ? (
                        <Check size={12} style={{ color: 'var(--success)' }} aria-hidden="true" />
                      ) : (
                        <X size={12} style={{ color: 'var(--text-subtle)' }} aria-hidden="true" />
                      )}
                      <span style={{ color: r.ok ? 'var(--text)' : 'var(--text-subtle)' }}>{r.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <FieldGroup
              id="confirm"
              label="Confirmar nova password"
              type={showPwd ? 'text' : 'password'}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              required
              minLength={8}
              leftIcon={<KeyRound size={16} />}
              error={confirmError ?? undefined}
              onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
            />

            <FormError message={showError ?? undefined} />

            <div className="pt-2">
              <SubmitButton loading={loading} loadingLabel="A guardar…">
                <span>Guardar nova password</span>
                <ArrowRight size={16} aria-hidden="true" />
              </SubmitButton>
            </div>
          </form>

          <p
            className="mt-6 text-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            <Link
              href="/login"
              className="font-medium transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              Voltar ao login
            </Link>
          </p>
        </AuthCard>
      </div>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthShell withBrandPanel={false}>
          <div className="max-w-md mx-auto">
            <BrandHeader title="A carregar…" />
          </div>
        </AuthShell>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}