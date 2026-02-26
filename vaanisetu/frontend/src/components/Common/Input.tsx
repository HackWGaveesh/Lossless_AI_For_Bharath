import React, { useState } from 'react';
import { clsx } from 'clsx';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'placeholder'> {
  label: string;
  error?: string;
  floatingLabel?: boolean;
  placeholder?: string;
}

export default function Input({
  label,
  error,
  floatingLabel = true,
  className,
  id,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const [hasValue, setHasValue] = useState(!!props.value || !!props.defaultValue);
  const inputId = id ?? `input-${label.replace(/\s/g, '-')}`;

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true);
    onFocus?.(e);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(false);
    setHasValue(!!e.target.value);
    onBlur?.(e);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHasValue(!!e.target.value);
    props.onChange?.(e);
  };

  const floatUp = floatingLabel && (focused || hasValue);

  return (
    <div className={clsx('relative', className)}>
      <input
        id={inputId}
        className={clsx(
          'w-full bg-surface-bg border rounded-lg px-4 pt-5 pb-2 text-text-primary transition-all duration-150',
          'border-surface-border focus:border-primary-500 focus:ring-[3px] focus:ring-primary-500/15',
          error && 'border-red-500 focus:border-red-500 focus:ring-red-500/15'
        )}
        placeholder={floatingLabel ? ' ' : label}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        aria-label={label}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...props}
      />
      {floatingLabel && (
        <label
          htmlFor={inputId}
          className={clsx(
            'absolute left-4 transition-all duration-150 pointer-events-none text-text-muted',
            floatUp ? 'top-2 text-xs text-primary-500' : 'top-1/2 -translate-y-1/2 text-base'
          )}
        >
          {label}
        </label>
      )}
      {error && (
        <p id={`${inputId}-error`} className="mt-1.5 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
