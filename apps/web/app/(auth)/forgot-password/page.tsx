'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, Mail, CheckCircle2 } from 'lucide-react';

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

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const forgotMutation = useMutation({
    mutationFn: () => apiClient.forgotPassword({ email }),
    onSuccess: () => setSubmittedEmail(email),
  });

  const emailError = useMemo(
    () =>
      touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? 'Email inválido.'
        : null,
    [touched, email],
  );

  const { onSubmit, loading } = useFormSubmit(async () => {
    setTouched(true);
    if (emailError) throw new Error('Verifique o email indicado.');
    await forgotMutation.mutateAsync();
  });

  const errorMsg = (forgotMutation.error as Error | undefined)?.message ?? null;

  if (submittedEmail) {
    return (
      <AuthShell withBrandPanel={false}>
        <div className="max-w-md mx-auto">
          <BrandHeader title="Verifique o seu email" />
          <AuthCard
            title="Pedido enviado"
            subtitle="Se a conta existir, receberá um email em instantes."
          >
            <div
              className="rounded-xl p-4 flex items-start gap-3 animate-in"
              style={{
                background: 'rgba(52, 211, 153, 0.10)',
                border: '1px solid rgba(52, 211, 153, 0.25)',
              }}
              role="status"
              aria-live="polite"
            >
              <span
                className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg"
                style={{ background: 'rgba(52, 211, 153, 0.18)' }}
                aria-hidden="true"
              >
                <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
              </span>
              <div className="text-sm" style={{ color: 'var(--success-fg)' }}>
                <p className="font-semibold mb-0.5">Link enviado para:</p>
                <p className="tabular-nums font-medium" style={{ color: 'var(--text)' }}>
                  {submittedEmail}
                </p>
              </div>
            </div>

            <p
              className="text-xs mt-5 leading-relaxed"
              style={{ color: 'var(--text-muted)' }}
            >
              Não recebeu? Verifique a pasta de spam ou aguarde alguns minutos.
              O link é válido por 30 minutos.
            </p>

            <div className="mt-6 flex items-center justify-between text-sm gap-3">
              <Link
                href="/login"
                className="font-medium inline-flex items-center gap-1 transition-opacity hover:opacity-80"
                style={{ color: 'var(--accent)' }}
              >
                Voltar ao login
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSubmittedEmail(null);
                  setEmail('');
                  setTouched(false);
                }}
                className="font-medium transition-opacity hover:opacity-80"
                style={{ color: 'var(--text-muted)' }}
              >
                Tentar novamente
              </button>
            </div>
          </AuthCard>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell withBrandPanel={false}>
      <div className="max-w-md mx-auto">
        <BrandHeader title="Recuperar password" subtitle="Vamos enviar-lhe um link para redefinir o acesso." />

        <AuthCard
          title="Esqueci-me da password"
          subtitle="Indique o email associado à sua conta."
        >
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <FieldGroup
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="nome@empresa.pt"
              autoComplete="email"
              inputMode="email"
              required
              leftIcon={<Mail size={16} />}
              error={emailError ?? undefined}
              onBlur={() => setTouched(true)}
            />

            <FormError message={errorMsg} />

            <div className="pt-2">
              <SubmitButton loading={loading} loadingLabel="A enviar…">
                <span>Enviar link de recuperação</span>
                <ArrowRight size={16} aria-hidden="true" />
              </SubmitButton>
            </div>
          </form>

          <p
            className="mt-6 text-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Lembrou-se?{' '}
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