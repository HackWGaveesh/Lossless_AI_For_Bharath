import React from 'react';
import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
  fullScreen?: boolean;
}

export function Skeleton({ className, fullScreen }: SkeletonProps) {
  const el = <div className={clsx('skeleton', className)} role="status" aria-label="Loading" />;
  if (fullScreen) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-surface-bg z-50">
        <div className="w-full max-w-md space-y-4 p-6">
          <div className="skeleton h-8 w-3/4" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-5/6" />
          <div className="skeleton h-12 w-full rounded-lg mt-6" />
        </div>
      </div>
    );
  }
  return el;
}

export function SkeletonCard() {
  return (
    <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
      <div className="skeleton h-5 w-1/3 mb-4" />
      <div className="skeleton h-6 w-2/3 mb-2" />
      <div className="skeleton h-4 w-full mb-2" />
      <div className="skeleton h-4 w-4/5" />
      <div className="skeleton h-10 w-24 rounded-lg mt-4" />
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-surface-card border border-surface-border rounded-card overflow-hidden shadow-card">
      <div className="flex gap-4 p-4 border-b border-surface-border">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-4 w-20" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 border-b border-surface-border last:border-0">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-4 flex-1" />
          <div className="skeleton h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
