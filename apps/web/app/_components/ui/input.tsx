'use client';

/**
 * Input — premium text input primitive with optional icons, label, and slots.
 *
 * - `label` renders a proper <label> bound to the input via id.
 * - `leftIcon` is absolutely positioned inside the field (for Mail, Lock, etc.)
 * - `rightSlot` is for toggle buttons (show password, etc.)
 * - `description` / `error` use aria-describedby wiring.
 * - Size: sm | md (default) | lg
 */

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertCircle } from 'lucide-react';

type Size = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange'> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  size?: Size;
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
  containerClassName?: string;
  /** Optional string-style onChange — receives the new value directly. */
  onChange?: (value: string) => void;
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'input-sm',
  md: '',
  lg: 'input-lg',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    id,
    label,
    description,
    error,
    required,
    size = 'md',
    leftIcon,
    rightSlot,
    className = '',
    containerClassName = '',
    type = 'text',
    onChange,
    ...rest
  },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `input-${reactId}`;
  const helpId = description ? `${inputId}-help` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  const invalid = Boolean(error);

  const cls = [
    'input',
    SIZE_CLASS[size],
    leftIcon ? 'pl-11' : '',
    rightSlot ? 'pr-11' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={['field-group', containerClassName].filter(Boolean).join(' ')}>
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
          {required && (
            <span aria-hidden="true" style={{ color: 'var(--danger)' }} className="ms-1">
              *
            </span>
          )}
        </label>
      )}
      <div className="relative">
        {leftIcon && (
          <span
            aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center"
            style={{ color: 'var(--text-subtle)' }}
          >
            {leftIcon}
          </span>
        )}
        <input
          id={inputId}
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cls}
          onChange={
            onChange
              ? (e) => onChange((e.target as HTMLInputElement).value)
              : undefined
          }
          {...rest}
        />
        {rightSlot && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
            {rightSlot}
          </div>
        )}
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
