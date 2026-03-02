import { useMemo } from 'react';
import { useQuery } from 'react-query';
import { fetchApplications } from '../services/api';
import ApplicationList from '../components/Dashboard/ApplicationList';
import Spinner from '../components/Common/Spinner';
import { useLanguage } from '../contexts/LanguageContext';

export default function ApplicationsPage() {
  const { t } = useLanguage();
  const { data: applications = [], isLoading } = useQuery('applications', () => fetchApplications());

  const summary = useMemo(() => {
    const submitted = applications.filter((a) => a.status === 'submitted').length;
    const pending = applications.filter((a) => a.status === 'pending').length;
    const approved = applications.filter((a) => a.status === 'approved').length;
    const rejected = applications.filter((a) => a.status === 'rejected').length;
    return { submitted, pending, approved, rejected };
  }, [applications]);

  const latest = applications[0];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text-primary">{t('applications.title')}</h1>

      <div className="bg-surface-card rounded-card shadow p-6 border border-surface-border">
        <h2 className="text-lg font-semibold text-text-primary mb-4">{t('applications.timeline')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-blue-800">Submitted: {summary.submitted}</div>
          <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-amber-800">Pending: {summary.pending}</div>
          <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-green-800">Approved: {summary.approved}</div>
          <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-red-800">Rejected: {summary.rejected}</div>
        </div>
        {latest && (
          <p className="text-sm text-text-secondary mt-4">
            Latest: {latest.application_id} - {latest.scheme_name || latest.scheme_code || latest.scheme_id} ({latest.status})
          </p>
        )}
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <ApplicationList applications={applications} />
      )}
    </div>
  );
}
