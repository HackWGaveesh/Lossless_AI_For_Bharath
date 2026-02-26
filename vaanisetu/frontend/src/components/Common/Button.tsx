import React from 'react';
import { clsx } from 'clsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  const baseClasses =
    'font-medium rounded-lg transition-all duration-150 ease-out disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none';

  const variantClasses = {
    primary:
      'bg-primary-500 text-white shadow-primary hover:bg-primary-400 hover:shadow-primary-hover hover:-translate-y-px active:translate-y-0 active:shadow-sm',
    secondary:
      'bg-secondary-500 text-white shadow-md hover:opacity-95 hover:-translate-y-px active:translate-y-0',
    outline:
      'border-2 border-primary-500 text-primary-500 bg-transparent hover:bg-primary-50 active:bg-primary-100',
    ghost: 'text-text-primary hover:bg-surface-elevated active:bg-surface-border',
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm rounded-md',
    md: 'px-6 py-3 text-base rounded-lg',
    lg: 'px-8 py-4 text-lg rounded-lg',
  };

  return (
    <button
      className={clsx(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}
