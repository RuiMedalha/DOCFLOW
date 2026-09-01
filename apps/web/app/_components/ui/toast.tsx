'use client';

/**
 * Toast — slim notification primitive backed by sonner (already installed).
 *
 * Re-exports the `toast` API + a few themed helpers so call sites stay
 * declarative. The Toaster is mounted once in providers.
 */

import { Toaster as SonnerToaster, toast } from 'sonner';
import type { ReactNode } from 'react';

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      theme="system"
      richColors
      closeButton
      duration={4500}
      toastOptions={{
        style: {
          background: 'var(--bg-card-solid)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          fontSize: '0.875rem',
          borderRadius: 'var(--radius)',
          padding: '0.75rem 1rem',
          boxShadow: 'var(--shadow-lg)',
        },
        className: 'animate-in',
      }}
    />
  );
}

export interface ToastOpts {
  description?: ReactNode;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export const toastBus = {
  success: (msg: string, opts?: ToastOpts) => toast.success(msg, opts as never),
  error: (msg: string, opts?: ToastOpts) => toast.error(msg, opts as never),
  info: (msg: string, opts?: ToastOpts) => toast(msg, opts as never),
  warning: (msg: string, opts?: ToastOpts) => toast.warning(msg, opts as never),
};
