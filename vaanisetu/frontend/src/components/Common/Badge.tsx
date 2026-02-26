import React from 'react';
import { clsx } from 'clsx';

type Status = 'submitted' | 'pending' | 'approved' | 'rejected';

const statusStyles: Record<Status, string> = {
  submitted: 'bg-indigo-100 text-indigo-700',
  pending: 'bg-amber-100 text-amber-800 pulse-pending',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

interface BadgeProps {
  status: Status | string;
  children?: React.ReactNode;
  className?: string;
}

export default function Badge({ status, children, className }: BadgeProps) {
  const normalized = status.toLowerCase() as Status;
  const style = statusStyles[normalized] ?? 'bg-surface-elevated text-text-secondary';

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        style,
        className
      )}
    >
      {children ?? status}
    </span>
  );
}
