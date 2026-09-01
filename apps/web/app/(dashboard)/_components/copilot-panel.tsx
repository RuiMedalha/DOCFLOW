'use client';

import { Sparkles, X, Send, Paperclip } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function CopilotPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');

  if (!open) return null;

  return (
    <aside
      role="complementary"
      aria-label="Copilot IA"
      className="fixed top-0 right-0 z-50 h-screen w-full sm:w-[420px] flex flex-col border-l animate-slide-in"
      style={{
        background: 'var(--bg-card-solid)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-xl)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <header
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, var(--accent-3), #f472b6)',
              boxShadow: '0 6px 20px -6px rgba(167, 139, 250, 0.50)',
            }}
          >
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
              Copilot IA
            </div>
            <div className="text-[11px]" style={{ color: 'var(--text-subtle)' }}>
              Assistente documental
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar Copilot"
          className="btn-ghost p-2"
        >
          <X size={16} />
        </button>
      </header>

      <Body>
        <EmptyState />
      </Body>

      <footer className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex items-end gap-2 rounded-xl p-2 border transition-colors focus-within:border-sky-400/60"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--input-bg)' }}
        >
          <button
            type="button"
            aria-label="Anexar documento"
            className="btn-ghost p-2"
            title="Anexar documento"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pergunte algo ao Copilot…"
            rows={1}
            className="flex-1 bg-transparent border-0 outline-none resize-none text-sm py-2 focus:ring-0"
            style={{ color: 'var(--text)' }}
            aria-label="Mensagem para o Copilot"
          />
          <button
            type="button"
            disabled={!draft.trim()}
            className="btn-primary p-2 disabled:opacity-50"
            aria-label="Enviar"
          >
            <Send size={16} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="flex-1 overflow-y-auto p-4">{children}</div>;
}

function EmptyState() {
  return (
    <div className="text-center mt-12">
      <div
        className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-4 animate-orb"
        style={{
          background: 'var(--brand-gradient-soft)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
        }}
      >
        <Sparkles size={22} style={{ color: 'var(--accent-3)' }} aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
        Copilot IA — em breve
      </h3>
      <p
        className="text-xs mt-1.5 max-w-[280px] mx-auto leading-relaxed"
        style={{ color: 'var(--text-muted)' }}
      >
        Pergunte sobre documentos, conciliações, pagamentos ou gere relatórios com citações automáticas.
      </p>
      <div className="mt-6 grid gap-2 text-left">
        <SuggestionChip text="Quais faturas estão em aberto este mês?" />
        <SuggestionChip text="Mostra divergências na última conciliação." />
        <SuggestionChip text="Resumo de pagamentos por fornecedor." />
      </div>
    </div>
  );
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="nav-item-idle w-full text-left text-xs"
      style={{ color: 'var(--text-muted)' }}
    >
      {text}
    </button>
  );
}