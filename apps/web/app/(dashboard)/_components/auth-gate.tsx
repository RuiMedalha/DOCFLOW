'use client';

/**
 * AuthGate — client-side protection for the (dashboard) route group.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '@/_lib/auth-store';

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!accessToken) {
      router.replace('/login');
    }
  }, [mounted, accessToken, router]);

  if (!mounted || !accessToken) {
    return (
      <div className="min-h-screen bg-mesh relative overflow-hidden flex items-center justify-center">
        <div
          aria-hidden="true"
          className="absolute top-1/4 -left-20 w-96 h-96 rounded-full blur-3xl animate-orb"
          style={{ background: 'var(--mesh-1)' }}
        />
        <div
          aria-hidden="true"
          className="absolute bottom-1/4 -right-20 w-96 h-96 rounded-full blur-3xl animate-orb"
          style={{ background: 'var(--mesh-2)', animationDelay: '4s' }}
        />
        <div className="flex flex-col items-center gap-4 relative z-10 animate-in">
          <div
            className="w-14 h-14 rounded-2xl brand-mark flex items-center justify-center animate-pulse-glow"
          >
            <Sparkles size={24} className="text-slate-950" />
          </div>
          <div className="flex flex-col items-center gap-1">
            <div
              className="text-sm font-semibold"
              style={{ color: 'var(--text)' }}
            >
              DocFlow
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              A carregar a sua área de trabalho…
            </div>
          </div>
          <div
            className="w-32 h-1 rounded-full overflow-hidden"
            style={{ background: 'var(--border)' }}
            aria-hidden="true"
          >
            <div
              className="h-full animate-shimmer"
              style={{
                width: '60%',
                background: 'var(--brand-gradient)',
                backgroundSize: '200% 100%',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}