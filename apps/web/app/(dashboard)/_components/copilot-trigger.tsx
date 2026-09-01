'use client';

/**
 * CopilotTrigger — button that opens/closes the Copilot IA slide-over.
 *
 * Mounted by the dashboard layout so every page can summon the panel.
 */

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CopilotPanel } from './copilot-panel';

export function CopilotTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden lg:inline-flex btn-secondary"
        aria-label="Abrir Copilot IA"
        title="Copilot IA"
      >
        <Sparkles size={16} className="text-violet-400" />
        <span className="text-sm">Copilot</span>
      </button>
      <CopilotPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}