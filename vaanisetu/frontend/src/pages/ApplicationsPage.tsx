import { useQuery } from 'react-query';
import { fetchApplications } from '../services/api';
import ApplicationList from '../components/Dashboard/ApplicationList';
import Spinner from '../components/Common/Spinner';
import { useLanguage } from '../contexts/LanguageContext';

export default function ApplicationsPage() {
  const { t } = useLanguage();
  const { data: applications, isLoading } = useQuery('applications', () => fetchApplications());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('applications.title')}</h1>
      <div className="bg-surface-card rounded-card shadow p-6 border border-surface-border">
        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('applications.timeline')}</h2>
        <ul className="space-y-4">
          <li className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <div>
              <p className="font-medium text-text-primary">{t('applications.status_submitted')}</p>
              <p className="text-sm text-text-muted">5 Feb 2024</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-amber-600 font-bold">⟳</span>
            <div>
              <p className="font-medium text-text-primary">{t('applications.doc_verification')}</p>
              <p className="text-sm text-text-muted">{t('documents.income_certificate')}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-gray-400">○</span>
            <div>
              <p className="font-medium text-text-muted">{t('applications.field_verification')}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-gray-400">○</span>
            <div>
              <p className="font-medium text-text-muted">{t('applications.approval')}</p>
            </div>
          </li>
        </ul>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <ApplicationList applications={Array.isArray(applications) ? applications : []} />
      )}
    </div>
  );
}
