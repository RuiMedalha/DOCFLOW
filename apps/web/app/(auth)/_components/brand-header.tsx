'use client';

import { Sparkles, Zap, ShieldCheck, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * BrandHeader — premium brand mark + headline.
 *
 * Renders a gradient logo + product name + a tagline. Used at the top of
 * every (auth) page above the form card.
 */
export function BrandHeader({
  title,
  subtitle,
  compact = false,
}: {
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? 'mb-6' : 'mb-8'} animate-in`}>
      <div className="inline-flex items-center gap-2 mb-5">
        <div
          aria-hidden="true"
          className="inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl brand-mark transition-transform duration-300 hover:scale-105"
        >
          <Sparkles size={24} className="text-slate-950 md:hidden" />
          <Sparkles size={28} className="text-slate-950 hidden md:block" />
        </div>
        <div className="flex flex-col items-start leading-none">
          <span className="text-lg md:text-xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>
            DocFlow
          </span>
          <span
            className="text-[10px] md:text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: 'var(--text-subtle)' }}
          >
            Document Intelligence
          </span>
        </div>
      </div>
      {title && (
        <h1
          className="text-2xl md:text-[2rem] font-bold tracking-tight leading-tight"
          style={{ color: 'var(--text)' }}
        >
          {title}
        </h1>
      )}
      {subtitle && (
        <p
          className="mt-2 text-sm md:text-[15px] max-w-md mx-auto leading-relaxed"
          style={{ color: 'var(--text-muted)' }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

/**
 * BrandPanel — wide split-screen left panel for desktop auth.
 * Shows the product promise + 3 trust signals. Hidden on mobile.
 */
export function BrandPanel() {
  // Compute the year only after mount to avoid SSR/CSR mismatches around
  // the year boundary (page cached on Dec 31 → served on Jan 1).
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return (
    <aside
      aria-hidden="true"
      className="hidden lg:flex relative flex-col justify-between p-10 xl:p-14 w-[480px] xl:w-[540px] flex-shrink-0 overflow-hidden glass-card animate-slide-in"
      style={{ borderRadius: 0 }}
    >
      {/* Decorative gradient */}
      <div
        className="absolute inset-0 -z-10 animate-orb"
        style={{
          background:
            'radial-gradient(60% 50% at 20% 10%, var(--mesh-1), transparent 60%), radial-gradient(50% 40% at 80% 80%, var(--mesh-2), transparent 60%)',
        }}
      />

      <BrandHeader compact />

      <div className="space-y-4 mt-8">
        <h2 className="text-3xl xl:text-4xl font-bold tracking-tight leading-[1.1]" style={{ color: 'var(--text)' }}>
          Documentos, contabilidade e conciliação.
          <br />
          <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'var(--brand-gradient)' }}>
            Tudo num só lugar.
          </span>
        </h2>
        <p className="text-sm xl:text-[15px] leading-relaxed max-w-md" style={{ color: 'var(--text-muted)' }}>
          A plataforma que automatiza o ciclo documental da sua PME portuguesa.
          Inteligência artificial, segurança bancária e conformidade AT incluídas.
        </p>

        <ul className="mt-8 space-y-3">
          <TrustItem
            icon={<Zap size={16} />}
            title="IA que entende PT-PT"
            description="Extrai dados de faturas, recibos e extratos com 99% de precisão."
          />
          <TrustItem
            icon={<ShieldCheck size={16} />}
            title="Segurança bancária"
            description="Encriptação AES-256, 2FA e conformidade RGPD completa."
          />
          <TrustItem
            icon={<Sparkles size={16} />}
            title="Pronto em minutos"
            description="Onboarding guiado. Sem cartões. Sem instalações."
          />
        </ul>
      </div>

      <footer className="mt-10 flex items-center justify-between text-xs" style={{ color: 'var(--text-subtle)' }}>
        <span suppressHydrationWarning>© {year ?? ' '} DocFlow · Portugal</span>
        <Link
          href="https://docflow.pt"
          className="inline-flex items-center gap-1 hover:underline transition-colors"
          style={{ color: 'var(--text-muted)' }}
        >
          docflow.pt
          <ArrowUpRight size={12} />
        </Link>
      </footer>
    </aside>
  );
}

function TrustItem({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg"
        style={{
          background: 'var(--brand-gradient-soft)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          color: 'var(--accent)',
        }}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
          {title}
        </div>
        <div className="text-xs leading-snug mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {description}
        </div>
      </div>
    </li>
  );
}