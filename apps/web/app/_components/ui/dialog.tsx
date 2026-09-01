'use client';

/**
 * Dialog — accessible modal primitive.
 *
 * - Closes on Escape, on backdrop click, on explicit close.
 * - Body scroll locked while open.
 * - Focus trap is the caller's responsibility (keep the dialog small).
 */

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  hideCloseButton?: boolean;
}

const SIZE_CLASS: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
  hideCloseButton = false,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      aria-describedby={description ? 'dialog-description' : undefined}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in"
        onClick={onClose}
      />
      <div
        className={['relative w-full glass-card animate-pop p-6 md:p-7', SIZE_CLASS[size]].join(' ')}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              {title && (
                <h3 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                  {title}
                </h3>
              )}
              {description && (
                <p id="dialog-description" className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="btn-ghost p-1.5 flex-shrink-0"
              >
                <X size={16} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
