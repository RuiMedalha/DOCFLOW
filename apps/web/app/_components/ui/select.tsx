'use client';

/**
 * Select — styled native <select> with label + error wiring.
 *
 * Uses the same `.input` class as the text input so both share the design
 * tokens. Native select keeps keyboard + a11y semantics for free.
 */

import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  description?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
  onChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    id,
    label,
    description,
    error,
    options,
    placeholder,
    required,
    className = '',
    containerClassName = '',
    onChange,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const selectId = id ?? `select-${reactId}`;
  const helpId = description ? `${selectId}-help` : undefined;
  const errorId = error ? `${selectId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['field-group', containerClassName].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={selectId} className="label">
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: 'var(--danger)' }} className="ms-1">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          ref={ref}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={describedBy}
          className={['input', 'pr-9', 'appearance-none', className].filter(Boolean).join(' ')}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--text-subtle)' }}
        />
      </div>
      {description && (
        <p id={helpId} className="field-help">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          <AlertCircle size={12} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
});

export type { ReactNode };
