import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useLanguage } from '../../contexts/LanguageContext';

export interface ApplicationItem {
  application_id: string;
  scheme_id: string;
  status: string;
  created_at: string;
}

interface ApplicationListProps {
  applications: ApplicationItem[];
}

const statusColors: Record<string, string> = {
  submitted: 'bg-blue-100 text-blue-800',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

const statusLabels: Record<string, string> = {
  submitted: 'applications.status_submitted',
  pending: 'applications.status_pending',
  approved: 'applications.status_approved',
  rejected: 'applications.status_rejected',
};

export default function ApplicationList({ applications }: ApplicationListProps) {
  const { t } = useLanguage();
  if (!applications?.length) {
    return (
      <div className="bg-surface-card rounded-card shadow p-6 border border-surface-border">
        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('dashboard.recent_applications')}</h2>
        <p className="text-text-muted">{t('applications.no_applications')} {t('applications.apply_first')}</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-card shadow border border-surface-border overflow-hidden">
      <div className="px-6 py-4 border-b border-surface-border">
        <h2 className="text-lg font-semibold text-text-primary">{t('dashboard.recent_applications')}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-surface-elevated">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('schemes.title').replace('Government ', '')}</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase">{t('applications.submitted_on')}</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {applications.map((app) => (
              <tr key={app.application_id} className="hover:bg-surface-elevated">
                <td className="px-6 py-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-text-muted" />
                  <span className="font-medium text-text-primary">{app.scheme_id}</span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      statusColors[app.status] ?? 'bg-surface-elevated text-text-secondary'
                    }`}
                  >
                    {statusLabels[app.status] ? t(statusLabels[app.status]) : app.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-text-muted">
                  {formatDistanceToNow(new Date(app.created_at), { addSuffix: true })}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link
                    to={`/applications?id=${app.application_id}`}
                    className="text-primary-600 hover:text-primary-700 font-medium text-sm"
                  >
                    {t('schemes.view_details')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
