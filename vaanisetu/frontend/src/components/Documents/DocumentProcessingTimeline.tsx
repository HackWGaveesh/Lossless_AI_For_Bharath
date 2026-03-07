import { AlertTriangle, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import type { DocumentProcessingStep } from '../../services/api';

function flattenValue(
  value: Record<string, unknown> | string[] | string | undefined,
  prefix = '',
): Array<{ label: string; value: string }> {
  if (value == null) return [];
  if (typeof value === 'string') return [{ label: prefix || 'Info', value }];
  if (Array.isArray(value)) return [{ label: prefix || 'Items', value: value.join(', ') }];

  return Object.entries(value).flatMap(([key, nested]) => {
    const label = prefix ? `${prefix} > ${key}` : key;
    if (nested == null) return [];
    if (typeof nested === 'string' || typeof nested === 'number' || typeof nested === 'boolean') {
      return [{ label, value: String(nested) }];
    }
    if (Array.isArray(nested)) {
      return [{ label, value: nested.map((item) => String(item)).join(', ') }];
    }
    if (typeof nested === 'object') {
      return flattenValue(nested as Record<string, unknown>, label);
    }
    return [];
  });
}

function statusStyles(status: DocumentProcessingStep['status']) {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />,
        badge: 'bg-green-50 text-green-700 border-green-200',
      };
    case 'failed':
      return {
        icon: <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />,
        badge: 'bg-red-50 text-red-700 border-red-200',
      };
    case 'in_progress':
      return {
        icon: <Loader2 className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />,
        badge: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    default:
      return {
        icon: <CircleDashed className="w-4 h-4 text-slate-400 shrink-0" />,
        badge: 'bg-slate-50 text-slate-600 border-slate-200',
      };
  }
}

export default function DocumentProcessingTimeline({
  steps,
  compact = false,
}: {
  steps?: DocumentProcessingStep[];
  compact?: boolean;
}) {
  if (!Array.isArray(steps) || steps.length === 0) return null;

  return (
    <div className={`space-y-3 ${compact ? '' : 'mt-4'} transition-all duration-300`}>
      {steps.map((step, index) => {
        const styles = statusStyles(step.status);
        const resultRows = flattenValue(step.result).slice(0, compact ? 2 : 4);

        return (
          <div
            key={step.id}
            className={`rounded-xl border px-3 py-3 transition-all duration-300 ease-out ${step.status === 'completed' ? 'border-green-100 bg-green-50/60' : step.status === 'in_progress' ? 'border-blue-100 bg-blue-50/60' : step.status === 'failed' ? 'border-red-100 bg-red-50/60' : 'border-surface-border bg-surface-elevated'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                {styles.icon}
                <div>
                  <div className="text-sm font-semibold text-text-primary">{step.label}</div>
                  {step.detail ? <div className="text-xs text-text-secondary mt-0.5">{step.detail}</div> : null}
                </div>
              </div>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles.badge}`}>
                {step.status.replace('_', ' ')}
              </span>
            </div>

            {resultRows.length > 0 ? (
              <div className={`mt-3 grid gap-2 transition-opacity duration-300 ${compact ? 'grid-cols-1' : 'md:grid-cols-2'}`}>
                {resultRows.map((row) => (
                  <div key={`${step.id}-${row.label}`} className="rounded-lg bg-white/80 px-2.5 py-2 border border-white/70 transition-colors duration-200">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{row.label}</div>
                    <div className="text-xs text-text-primary break-words">{row.value}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
