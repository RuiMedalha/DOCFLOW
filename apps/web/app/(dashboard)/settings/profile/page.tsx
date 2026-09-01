'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '../../_components/page-header';
import { ProfilePanel } from '../_components/profile-panel';

export default function ProfileSettingsPage() {
  return (
    <>
      <Link href="/settings" className="text-xs inline-flex items-center gap-1 mb-3" style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft size={12} /> Voltar
      </Link>
      <PageHeader title="Perfil" subtitle="Identidade, email e password." />
      <ProfilePanel />
    </>
  );
}