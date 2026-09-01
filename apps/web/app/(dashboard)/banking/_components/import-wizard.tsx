'use client';

/**
 * DocFlow — ImportWizard (F.5): 4-step CSV bank statement import.
 *
 * upload → mapping → preview → done. Parses the CSV client-side with
 * papaparse to detect columns, sends the mapping to the backend for a
 * server-side preview, then imports. A bank preset can pre-fill the
 * mapping. On finish, the parent refreshes the transaction list.
 */

import { useCallback, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { UploadCloud, ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Button, Select, Input } from '../../../_components/ui';
import { toastBus } from '../../../_components/ui';
import { WizardSteps } from './wizard-steps';
import {
  BANK_PRESETS,
  type CsvColumnMapping,
  type DateFormat,
  type PreviewResult,
  type WizardStep,
} from '../_lib/types';
import { usePreviewCsv, useImportCsv } from '../_lib/use-banking-queries';
import { formatCurrency, formatDate } from '../../../_lib/format';

const DATE_FORMAT_OPTIONS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/AAAA' },
  { value: 'DD-MM-YYYY', label: 'DD-MM-AAAA' },
  { value: 'YYYY-MM-DD', label: 'AAAA-MM-DD' },
];

const MAPPING_FIELDS: Array<{ key: keyof CsvColumnMapping; label: string; required?: boolean }> = [
  { key: 'date', label: 'Data', required: true },
  { key: 'description', label: 'Descrição', required: true },
  { key: 'amount', label: 'Valor (montante único)' },
  { key: 'debit', label: 'Débito' },
  { key: 'credit', label: 'Crédito' },
  { key: 'balance', label: 'Saldo' },
  { key: 'reference', label: 'Referência' },
];

export function ImportWizard({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvColumnMapping>({ date: '', description: '' });
  const [dateFormat, setDateFormat] = useState<DateFormat>('DD/MM/YYYY');
  const [saveAs, setSaveAs] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  const previewMutation = usePreviewCsv();
  const importMutation = useImportCsv();

  const columnOptions = useMemo(
    () => headers.map((h) => ({ value: h, label: h })),
    [headers],
  );

  const onFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setContent(text);
      const parsed = Papa.parse<string[]>(text, { preview: 1 });
      const firstRow = (parsed.data?.[0] as string[]) ?? [];
      setHeaders(firstRow.map((h) => String(h).trim()).filter(Boolean));
      setStep('mapping');
    };
    reader.readAsText(file);
  }, []);

  const applyPreset = (name: string) => {
    const preset = BANK_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    setMapping(preset.mapping);
    setDateFormat(preset.dateFormat);
  };

  const canPreview = Boolean(mapping.date && mapping.description && (mapping.amount || (mapping.debit && mapping.credit)));

  const runPreview = async () => {
    try {
      const result = await previewMutation.mutateAsync({
        content,
        mapping,
        dateFormat,
        hasHeader: true,
      });
      setPreview(result);
      setStep('preview');
    } catch (err) {
      toastBus.error('Não foi possível pré-visualizar', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const runImport = async () => {
    try {
      const result = await importMutation.mutateAsync({
        content,
        mapping,
        dateFormat,
        hasHeader: true,
        saveAsTemplate: saveAs || undefined,
      });
      toastBus.success(`${result.imported} movimentos importados`, {
        description: result.duplicates ? `${result.duplicates} duplicados ignorados` : undefined,
      });
      setStep('done');
      onDone?.();
    } catch (err) {
      toastBus.error('A importação falhou', {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const reset = () => {
    setStep('upload');
    setFileName('');
    setContent('');
    setHeaders([]);
    setMapping({ date: '', description: '' });
    setPreview(null);
    setSaveAs('');
  };

  return (
    <div className="card p-6 animate-in space-y-6">
      <WizardSteps current={step} />

      {step === 'upload' && (
        <label
          className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed cursor-pointer py-12 transition-colors"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--hover)' }}
        >
          <UploadCloud size={32} style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            Arraste ou clique para carregar o CSV do banco
          </span>
          <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>
            Formatos: CSV exportado do homebanking (CGD, Millennium, BPI, Novo Banco…)
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
      )}

      {step === 'mapping' && (
        <div className="space-y-5">
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <FileSpreadsheet size={16} style={{ color: 'var(--accent)' }} />
            {fileName}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Preset de banco"
              placeholder="Escolher preset…"
              options={BANK_PRESETS.map((p) => ({ value: p.name, label: p.name }))}
              onChange={applyPreset}
            />
            <Select
              label="Formato de data"
              options={DATE_FORMAT_OPTIONS}
              value={dateFormat}
              onChange={(v) => setDateFormat(v as DateFormat)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {MAPPING_FIELDS.map((field) => (
              <Select
                key={field.key}
                label={field.label}
                required={field.required}
                placeholder="— sem mapeamento —"
                options={columnOptions}
                value={mapping[field.key] ?? ''}
                onChange={(v) => setMapping((m) => ({ ...m, [field.key]: v }))}
              />
            ))}
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" leftIcon={<ArrowLeft size={15} />} onClick={reset}>
              Recomeçar
            </Button>
            <Button
              variant="primary"
              rightIcon={<ArrowRight size={15} />}
              disabled={!canPreview}
              loading={previewMutation.isPending}
              onClick={runPreview}
            >
              Pré-visualizar
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="space-y-5">
          {(() => {
            const previewRows = preview.rows ?? preview.preview ?? [];
            return (
              <>
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {preview.totalRows} linhas detetadas. Mostrando as primeiras {previewRows.length}.
                </p>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Data', 'Descrição', 'Valor', 'Saldo', 'Referência'].map((h) => (
                            <th key={h} className="text-left font-medium px-3 py-2" style={{ color: 'var(--text-subtle)' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td className="px-3 py-2 tabular-nums">{formatDate(row.date)}</td>
                            <td className="px-3 py-2">{row.description}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCurrency(row.amount)}</td>
                            <td className="px-3 py-2 tabular-nums">{formatCurrency(row.balance)}</td>
                            <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{row.reference ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}

          <Input
            label="Guardar mapeamento como template (opcional)"
            placeholder="ex.: Millennium — conta corrente"
            value={saveAs}
            onChange={setSaveAs}
          />

          <div className="flex items-center justify-between">
            <Button variant="ghost" leftIcon={<ArrowLeft size={15} />} onClick={() => setStep('mapping')}>
              Voltar
            </Button>
            <Button
              variant="primary"
              rightIcon={<ArrowRight size={15} />}
              loading={importMutation.isPending}
              onClick={runImport}
            >
              Importar {preview.totalRows} movimentos
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 size={40} style={{ color: 'var(--success)' }} aria-hidden="true" />
          <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>
            Importação concluída
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Os movimentos estão disponíveis na tabela abaixo e prontos para conciliação.
          </p>
          <Button variant="secondary" onClick={reset}>
            Importar outro ficheiro
          </Button>
        </div>
      )}
    </div>
  );
}
