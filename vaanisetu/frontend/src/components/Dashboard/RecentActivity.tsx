import { CheckCircle, Clock, Upload } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

const activityKeys = [
  { icon: CheckCircle, textKey: 'applications.status_approved', timeKey: 'applications.days_ago', timeVal: 2, color: 'text-green-600' },
  { icon: Upload, textKey: 'documents.uploaded', timeKey: 'applications.days_ago', timeVal: 3, color: 'text-blue-600' },
  { icon: Clock, textKey: 'applications.status_pending', timeKey: 'applications.days_ago', timeVal: 5, color: 'text-amber-600' },
];

export default function RecentActivity() {
  const { t } = useLanguage();
  return (
    <div className="bg-surface-card rounded-card shadow border border-surface-border p-6">
      <h3 className="text-lg font-semibold text-text-primary mb-4">{t('dashboard.recent_activity')}</h3>
      <ul className="space-y-4">
        {activityKeys.map((item, i) => (
          <li key={i} className="flex gap-3">
            <div className={`shrink-0 ${item.color}`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">{t(item.textKey)}</p>
              <p className="text-xs text-text-muted">{item.timeVal} {t(item.timeKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
