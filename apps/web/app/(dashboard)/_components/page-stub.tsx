'use client';

import type { ReactNode } from 'react';
import { PageHeader } from './page-header';
import { Construction, ArrowRight } from 'lucide-react';

export interface StubProps {
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
  children?: ReactNode;
}

export function PageStub({
  title,
  subtitle,
  description = 'Esta vista está em construção. O conteúdo detalhado será integrado pela equipa responsável.',
  badge = 'Em breve',
  children,
}: StubProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={<span className="badge-violet">{badge}</span>} />
      <div className="glass-card p-8 md:p-12 text-center animate-pop">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 animate-orb"
          style={{
            background: 'var(--brand-gradient-soft)',
            border: '1px solid rgba(56, 189, 248, 0.25)',
          }}
        >
          <Construction size={28} style={{ color: 'var(--accent)' }} aria-hidden="true" />
        </div>
        <h2 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
          {title}
        </h2>
        <p
          className="text-sm mt-2 max-w-md mx-auto leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {description}
        </p>
        {children && <div className="mt-6">{children}</div>}
        <div className="mt-8 flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--text-subtle)' }}>
          <span>Acompanhe o progresso no roadmap</span>
          <ArrowRight size={12} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}