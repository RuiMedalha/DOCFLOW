'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Building2, Mail, Lock, Sparkles } from 'lucide-react';

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

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);

  const [email, setEmail] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState({
    email: false,
    tenantSlug: false,
    password: false,
  });

  const loginMutation = useMutation({
    mutationFn: ({
      normalizedEmail,
      normalizedTenantSlug,
      normalizedPassword,
    }: {
      normalizedEmail: string;
      normalizedTenantSlug: string;
      normalizedPassword: string;
    }) =>
      apiClient.login({
        email: normalizedEmail,
        password: normalizedPassword,
        tenantSlug: normalizedTenantSlug,
        remember,
      }),
    onSuccess: (data: any, vars) => {
      setSession({
        email: vars.normalizedEmail,
        tenantSlug: vars.normalizedTenantSlug,
        accessToken: data?.accessToken ?? null,
        refreshToken: data?.refreshToken ?? null,
      });
      if (data?.requiresTwoFactor) {
        router.push('/2fa/verify');
      } else {
        router.push('/dashboard');
      }
    },
  });

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedTenantSlug = tenantSlug.trim().toLowerCase();
  const normalizedPassword = password.trim();

  const emailError =
    touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      ? 'Email inválido.'
      : null;
  const tenantError =
    touched.tenantSlug && !slugRegex.test(normalizedTenantSlug)
      ? 'Slug inválido (letras minúsculas, números e hífen).'
      : null;
  const passwordError =
    touched.password && normalizedPassword.length < 8
      ? 'A password deve ter pelo menos 8 caracteres.'
      : null;

  const { onSubmit, loading } = useFormSubmit(async () => {
    setTouched({ email: true, tenantSlug: true, password: true });
    if (emailError || tenantError || passwordError) {
      throw new Error('Verifique os campos assinalados.');
    }
    await loginMutation.mutateAsync({
      normalizedEmail,
      normalizedTenantSlug,
      normalizedPassword,
    });
  });

  const errorMsg = (() => {
    const err = loginMutation.error as
      | (Error & { status?: number })
      | undefined;
    if (!err) return null;
    if (err.status === 401) {
      return 'Email, palavra-passe ou empresa incorretos.';
    }
    return err.message ?? null;
  })();

  return (
    <AuthShell>
      <div className="lg:hidden mb-6">
        <BrandHeader subtitle="Gestão inteligente de documentos & conciliação" />
      </div>

      <AuthCard
        title="Entrar"
        subtitle="Aceda ao workspace da sua organização."
      >
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FieldGroup
            id="tenantSlug"
            label="Tenant (slug)"
            value={tenantSlug}
            onChange={setTenantSlug}
            placeholder="a-minha-empresa"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            required
            leftIcon={<Building2 size={16} />}
            description="Identificador único da sua organização."
            error={tenantError ?? undefined}
            onBlur={() => setTouched((t) => ({ ...t, tenantSlug: true }))}
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
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            minLength={8}
            leftIcon={<Lock size={16} />}
            error={passwordError ?? undefined}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
          />

          <div className="flex items-center justify-between gap-3 text-sm pt-1">
            <CheckboxField
              id="remember"
              checked={remember}
              onChange={setRemember}
            >
              Manter sessão
            </CheckboxField>
            <Link
              href="/forgot-password"
              className="font-medium inline-flex items-center gap-1 transition-opacity hover:opacity-80"
              style={{ color: 'var(--accent)' }}
            >
              Esqueci-me da password
            </Link>
          </div>

          <FormError message={errorMsg} />

          <div className="pt-2">
            <SubmitButton loading={loading} loadingLabel="A entrar…">
              <span>Entrar no DocFlow</span>
              <ArrowRight size={16} aria-hidden="true" />
            </SubmitButton>
          </div>
        </form>

        <div className="divider-or my-6">ou</div>

        <Link
          href="/register"
          className="btn btn-secondary w-full justify-center"
        >
          <Sparkles size={16} style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span>Criar nova organização</span>
        </Link>

        <p
          className="mt-6 text-center text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          Não tem conta?{' '}
          <Link
            href="/register"
            className="font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            Comece agora
          </Link>
        </p>
      </AuthCard>

      <AuthTermsFooter />
    </AuthShell>
  );
}