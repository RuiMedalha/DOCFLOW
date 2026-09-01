'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Building2, Mail, Lock, Eye, EyeOff, Check, X } from 'lucide-react';

import { apiClient } from '../../_lib/api-client';
import { useAuthStore } from '../../_lib/auth-store';
import {
  AuthCard,
  AuthShell,
  BrandHeader,
  AuthTermsFooter,
  CheckboxField,
  FieldGroup,
  FormError,
  SubmitButton,
  useFormSubmit,
} from '../_components/auth-shell';

export default function RegisterPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [tenantName, setTenantName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState({
    tenantName: false,
    email: false,
    password: false,
    confirm: false,
  });

  // Heuristic password meter — minimum 8 chars, mixed case + digit.
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

  const registerMutation = useMutation({
    mutationFn: () =>
      apiClient.register({ email, tenantName, password, terms }),
    onSuccess: (data: any) => {
      setSession({
        email,
        accessToken: data?.accessToken ?? null,
        refreshToken: data?.refreshToken ?? null,
        tenantName,
        tenantSlug: data?.tenant?.slug ?? null,
      });
      router.push('/dashboard');
    },
  });

  const tenantError =
    touched.tenantName && tenantName.trim().length < 2
      ? 'Indique o nome da organização.'
      : null;
  const emailError =
    touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? 'Email inválido.'
      : null;
  const passwordError =
    touched.password && password.length < 8
      ? 'A password deve ter pelo menos 8 caracteres.'
      : null;
  const confirmError =
    touched.confirm && password !== confirm
      ? 'As passwords não coincidem.'
      : null;

  const { onSubmit, loading } = useFormSubmit(async () => {
    setTouched({ tenantName: true, email: true, password: true, confirm: true });
    if (!terms) throw new Error('Tem de aceitar os termos para continuar.');
    if (
      tenantError ||
      emailError ||
      passwordError ||
      confirmError ||
      !terms
    ) {
      throw new Error('Verifique os campos assinalados.');
    }
    await registerMutation.mutateAsync();
  });

  const errorMsg =
    (registerMutation.error as Error | undefined)?.message ?? null;

  const strengthLabel = ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Forte'][
    passwordStrength
  ];
  const strengthColor = [
    'var(--danger)',
    'var(--danger)',
    'var(--warning)',
    'var(--accent)',
    'var(--success)',
  ][passwordStrength];

  return (
    <AuthShell maxWidth="max-w-lg">
      <div className="lg:hidden mb-6">
        <BrandHeader subtitle="Comece a usar o DocFlow em minutos." />
      </div>

      <AuthCard
        title="Criar organização"
        subtitle="A sua conta será o primeiro administrador."
      >
        <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
          <FieldGroup
            id="tenantName"
            label="Nome da empresa"
            value={tenantName}
            onChange={setTenantName}
            placeholder="ACME, Lda."
            autoComplete="organization"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            leftIcon={<Building2 size={16} />}
            error={tenantError ?? undefined}
            onBlur={() => setTouched((t) => ({ ...t, tenantName: true }))}
          />

          <FieldGroup
            id="email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            required
            leftIcon={<Mail size={16} />}
            error={emailError ?? undefined}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          />

          <FieldGroup
            id="password"
            label="Password"
            type={showPwd ? 'text' : 'password'}
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            required
            minLength={8}
            leftIcon={<Lock size={16} />}
            error={passwordError ?? undefined}
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
                <span
                  className="text-xs font-medium tabular-nums w-20 text-right"
                  style={{ color: strengthColor }}
                >
                  {strengthLabel}
                </span>
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
            label="Confirmar password"
            type={showPwd ? 'text' : 'password'}
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            required
            minLength={8}
            leftIcon={<Lock size={16} />}
            error={confirmError ?? undefined}
            onBlur={() => setTouched((t) => ({ ...t, confirm: true }))}
          />

          <div className="pt-1">
            <CheckboxField
              id="terms"
              checked={terms}
              onChange={setTerms}
            >
              Aceito os{' '}
              <Link
                href="/legal/terms"
                className="underline underline-offset-2"
                style={{ color: 'var(--accent)' }}
              >
                Termos de Serviço
              </Link>{' '}
              e a{' '}
              <Link
                href="/legal/privacy"
                className="underline underline-offset-2"
                style={{ color: 'var(--accent)' }}
              >
                Política de Privacidade
              </Link>
              .
            </CheckboxField>
          </div>

          <FormError message={errorMsg} />

          <div className="pt-2">
            <SubmitButton loading={loading} loadingLabel="A criar conta…">
              <span>Criar conta</span>
              <ArrowRight size={16} aria-hidden="true" />
            </SubmitButton>
          </div>
        </form>

        <p
          className="mt-6 text-center text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          Já tem conta?{' '}
          <Link
            href="/login"
            className="font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            Entrar
          </Link>
        </p>
      </AuthCard>

      <AuthTermsFooter />
    </AuthShell>
  );
}