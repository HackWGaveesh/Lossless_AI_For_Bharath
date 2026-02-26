import { Link } from 'react-router-dom';
import { FileText, Upload, Search } from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';

const actionKeys: { to: string; icon: typeof FileText; labelKey: string }[] = [
  { to: '/schemes', icon: FileText, labelKey: 'nav.schemes' },
  { to: '/documents', icon: Upload, labelKey: 'documents.upload_title' },
  { to: '/jobs', icon: Search, labelKey: 'nav.jobs' },
];

export default function QuickActions() {
  const { t } = useLanguage();
  return (
    <div className="bg-surface-card rounded-card shadow border border-surface-border p-6">
      <h3 className="text-lg font-semibold text-text-primary mb-4">{t('dashboard.quick_actions')}</h3>
      <div className="space-y-2">
        {actionKeys.map(({ to, icon: Icon, labelKey }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-primary-50 text-text-secondary hover:text-primary-600 transition-colors"
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="font-medium">{t(labelKey)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
