'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, ShieldCheck } from 'lucide-react';

import { apiClient } from '../../../_lib/api-client';
import { useAuthStore } from '../../../_lib/auth-store';
import {
  AuthCard,
  AuthShell,
  BrandHeader,
  FormError,
  SubmitButton,
  useFormSubmit,
} from '../../_components/auth-shell';

const CODE_LENGTH = 6;

export default function TwoFactorVerifyPage() {
  const router = useRouter();
  const requiresTwoFactor = useAuthStore((s) => s.requiresTwoFactor);
  const setSession = useAuthStore((s) => s.setSession);

  const [digits, setDigits] = useState<string[]>(
    Array(CODE_LENGTH).fill(''),
  );
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!requiresTwoFactor) router.replace('/login');
  }, [requiresTwoFactor, router]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const verifyMutation = useMutation({
    mutationFn: (code: string) => apiClient.verify2fa({ code }),
    onSuccess: () => {
      setSession({ requiresTwoFactor: false });
      router.push('/dashboard');
    },
  });

  const code = digits.join('');
  const codeError =
    digits.some((d) => d) && code.length !== CODE_LENGTH
      ? `O código tem ${CODE_LENGTH} dígitos.`
      : null;

  const { onSubmit, loading } = useFormSubmit(async () => {
    if (codeError) throw new Error(codeError);
    await verifyMutation.mutateAsync(code);
  });

  const errorMsg = (verifyMutation.error as Error | undefined)?.message ?? null;

  function setDigit(index: number, value: string) {
    const v = value.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
    if (v && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handleKey(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const data = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!data) return;
    e.preventDefault();
    const next = Array(CODE_LENGTH).fill('');
    for (let i = 0; i < Math.min(data.length, CODE_LENGTH); i++) {
      next[i] = data[i];
    }
    setDigits(next);
    const focusIndex = Math.min(data.length, CODE_LENGTH - 1);
    inputs.current[focusIndex]?.focus();
  }

  return (
    <AuthShell withBrandPanel={false}>
      <div className="max-w-md mx-auto">
        <BrandHeader
          title="Verificação em dois passos"
          subtitle="Abra a sua aplicação autenticadora e insira o código de 6 dígitos."
        />

        <AuthCard
          title="Código TOTP"
          subtitle="O código é válido durante 30 segundos."
        >
          <form onSubmit={onSubmit} className="space-y-6" noValidate>
            <div className="flex justify-center gap-2 sm:gap-3">
              {digits.map((d, i) => {
                const isFilled = d.length > 0;
                return (
                  <input
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="\d{1}"
                    maxLength={1}
                    autoComplete="one-time-code"
                    value={d}
                    aria-label={`Dígito ${i + 1}`}
                    aria-invalid={Boolean(codeError) || undefined}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKey(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    className="input text-center text-xl sm:text-2xl font-bold tabular-nums w-11 sm:w-12 h-14 sm:h-16 transition-all"
                    style={{
                      caretColor: 'transparent',
                      borderColor: isFilled ? 'var(--accent)' : undefined,
                      boxShadow: isFilled ? '0 0 0 3px rgba(56, 189, 248, 0.18)' : undefined,
                    }}
                  />
                );
              })}
            </div>

            <FormError message={codeError ?? errorMsg} />

            <SubmitButton loading={loading} loadingLabel="A verificar…">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Verificar</span>
              <ArrowRight size={16} aria-hidden="true" />
            </SubmitButton>
          </form>

          <p
            className="mt-6 text-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Perdeu o acesso ao autenticador?{' '}
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