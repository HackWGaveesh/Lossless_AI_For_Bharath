import React, { useEffect } from 'react';
import { clsx } from 'clsx';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  onDismiss: () => void;
  duration?: number;
}

export default function Toast({ message, type = 'info', onDismiss, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [onDismiss, duration]);

  return (
    <div
      role="alert"
      className={clsx(
        'fixed bottom-6 right-6 z-[100] px-4 py-3 rounded-lg shadow-lg border font-sans text-sm font-medium',
        type === 'success' && 'bg-green-100 border-green-700 text-green-800',
        type === 'error' && 'bg-red-100 border-red-700 text-red-800',
        type === 'info' && 'bg-surface-card border-surface-border text-text-primary'
      )}
    >
      {message}
    </div>
  );
}

let toastCallback: ((message: string, type: ToastType) => void) | null = null;

export function setToastHandler(cb: (message: string, type: ToastType) => void) {
  toastCallback = cb;
}

export function showToast(message: string, type: ToastType = 'info') {
  toastCallback?.(message, type);
}
