'use client';

/**
 * DocFlow — Settings · Tenant profile & users.
 */

import { useEffect, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { authedFetch } from '../../../_lib/auth-refresh';
import { useAuthStore } from '../../../_lib/auth-store';

const API_BASE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '')) || 'http://localhost:4000/api/v1';

export function ProfilePanel() {
  const { email, tenantSlug, tenantName } = useAuthStore();
  const [form, setForm] = useState({
    name: tenantName ?? '',
    slug: tenantSlug ?? '',
    email: email ?? '',
  });
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setForm({ name: tenantName ?? '', slug: tenantSlug ?? '', email: email ?? '' });
  }, [tenantName, tenantSlug, email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await authedFetch(`${API_BASE}/auth/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFeedback({ type: 'ok', msg: 'Perfil atualizado. As alterações refletem-se após a próxima sessão.' });
    } catch (err) {
      setFeedback({ type: 'err', msg: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 space-y-4 max-w-xl">
      <div>
        <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Nome do tenant</label>
        <input className="input mt-1 w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Slug (URL)</label>
        <input className="input mt-1 w-full font-mono text-xs" value={form.slug} disabled />
        <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>O slug é imutável após criação.</p>
      </div>
      <div>
        <label className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Email principal</label>
        <input type="email" className="input mt-1 w-full" value={form.email} disabled />
      </div>

      {feedback && (
        <div
          className="rounded-md p-2 text-xs"
          style={{
            background: feedback.type === 'ok' ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${feedback.type === 'ok' ? 'rgba(34,197,94,0.30)' : 'rgba(248,113,113,0.30)'}`,
          }}
        >
          {feedback.msg}
        </div>
      )}

      <button type="submit" className="btn-primary text-sm" disabled={submitting}>
        {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        Guardar
      </button>
    </form>
  );
}