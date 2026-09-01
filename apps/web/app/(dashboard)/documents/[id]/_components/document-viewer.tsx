'use client';

/**
 * DocumentViewer — PDF / image preview pane for DocFlow documents.
 *
 * Renders the document binary fetched from the API. The preview is read
 * through the auth-aware API client (Bearer token attached automatically)
 * and turned into a blob URL on the client; the URL is revoked when the
 * component unmounts to avoid leaking references.
 *
 * Three render modes:
 *   - application/pdf → <object>/<iframe> embed with the blob URL
 *   - image/*         → <img> with the blob URL
 *   - other           → fallback panel + download CTA
 *
 * Renders a skeleton while loading and an error card when the file can't
 * be fetched. Field highlights from the QR-AT decoder are mirrored as
 * badge overlays when present (PDF mode only).
 */

import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { authedFetch } from '../../../../_lib/auth-refresh';

export interface DocumentViewerProps {
  /** Absolute URL to fetch the binary from (must include bearer token on server). */
  src: string;
  /** Optional filename shown in the download button. */
  fileName?: string;
  /** Optional MIME type — when omitted the viewer sniffs the response Content-Type. */
  mimeType?: string;
  /** Field codes from QR-AT that the viewer should highlight (PDF only, stub). */
  highlightFields?: string[];
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

function pickIcon(mime?: string): 'pdf' | 'image' | 'file' {
  if (!mime) return 'file';
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  return 'file';
}

export function DocumentViewer({ src, fileName = 'documento', mimeType, highlightFields = [] }: DocumentViewerProps) {
  const [state, setState] = useState<LoadState>('idle');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [resolvedType, setResolvedType] = useState<string | undefined>(mimeType);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!src) return;
    setState('loading');
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        // Use authedFetch so the bearer token is attached and a 401 triggers
        // a single token refresh+retry (same path as http.ts / api-client.ts).
        // The previous raw `fetch(src)` skipped auth, so the API returned 401
        // and the blob never loaded — the viewer rendered blank.
        const res = await authedFetch(src, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('Content-Type') ?? mimeType ?? 'application/octet-stream';
        setResolvedType(ct);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState('ready');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message ?? 'Falha ao carregar');
        setState('error');
      }
    })();

    return () => {
      ctrl.abort();
    };
  }, [src, mimeType]);

  // Revoke blob URL on unmount or when src changes.
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const icon = pickIcon(resolvedType);

  return (
    <div
      className="card overflow-hidden flex flex-col h-full min-h-[420px]"
      style={{ background: 'var(--bg-card)' }}
    >
      {/* Toolbar */}
      <header
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border"
        style={{ background: 'var(--bg-elevated)' }}
      >
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg" style={{ background: 'var(--hover)' }}>
          {icon === 'pdf' ? (
            <FileText size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          ) : icon === 'image' ? (
            <ImageIcon size={14} aria-hidden="true" style={{ color: 'var(--accent)' }} />
          ) : (
            <FileText size={14} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
          )}
        </span>
        <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--text)' }} title={fileName}>
          {fileName}
        </span>
        {highlightFields.length > 0 && (
          <span className="badge-violet text-[10px]" title="Campos QR-AT detetados">
            {highlightFields.length} campo{highlightFields.length === 1 ? '' : 's'} destacado{highlightFields.length === 1 ? '' : 's'}
          </span>
        )}
        {blobUrl && (
          <>
            <a
              href={blobUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost text-xs px-2.5 py-1.5"
              title="Abrir numa nova janela"
            >
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a href={blobUrl} download={fileName} className="btn-ghost text-xs px-2.5 py-1.5" title="Transferir">
              <Download size={12} aria-hidden="true" />
            </a>
          </>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 min-h-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.18)' }}>
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={22} className="animate-spin" aria-hidden="true" />
            A carregar documento…
          </div>
        )}

        {state === 'error' && (
          <div className="text-center max-w-xs px-6">
            <FileText size={28} className="mx-auto mb-2" aria-hidden="true" style={{ color: 'var(--danger)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              Não foi possível carregar o documento
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {error ?? 'Erro desconhecido'}
            </p>
          </div>
        )}

        {state === 'ready' && blobUrl && (
          <PdfOrImage blobUrl={blobUrl} mime={resolvedType} />
        )}

        {state === 'idle' && (
          <div className="flex flex-col items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <FileText size={22} aria-hidden="true" />
            Sem documento
          </div>
        )}
      </div>
    </div>
  );
}

function PdfOrImage({ blobUrl, mime }: { blobUrl: string; mime?: string }) {
  if (mime?.includes('pdf')) {
    return (
      <iframe
        src={blobUrl}
        title="Pré-visualização do documento PDF"
        className="w-full h-full min-h-[420px]"
        style={{ border: 'none' }}
      />
    );
  }
  if (mime?.startsWith('image/')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={blobUrl}
        alt="Pré-visualização do documento"
        className="max-w-full max-h-full object-contain"
      />
    );
  }
  return (
    <div className="text-center px-6">
      <FileText size={28} className="mx-auto mb-2" aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
      <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
        Tipo de ficheiro sem pré-visualização
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
        Transfira o ficheiro para o abrir na aplicação nativa.
      </p>
    </div>
  );
}