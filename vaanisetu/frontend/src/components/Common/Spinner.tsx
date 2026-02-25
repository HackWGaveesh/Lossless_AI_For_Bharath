import React from 'react';
import { clsx } from 'clsx';

interface SpinnerProps {
  fullScreen?: boolean;
  className?: string;
}

export default function Spinner({ fullScreen, className }: SpinnerProps) {
  const spinner = (
    <div
      className={clsx(
        'inline-block w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin',
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );

  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-50/80 z-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}
