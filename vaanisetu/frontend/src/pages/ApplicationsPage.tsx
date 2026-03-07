import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from 'react-query';
import { fetchApplications, fetchApplicationDetail, type ApplicationDetailItem } from '../services/api';
import ApplicationList from '../components/Dashboard/ApplicationList';
import Spinner from '../components/Common/Spinner';
import { useLanguage } from '../contexts/LanguageContext';
import { ArrowLeft, FileText, User } from 'lucide-react';

const PROFILE_LABELS: Record<string, string> = {
  name: 'Name',
  fullName: 'Full name',
  phone: 'Phone',
  phone_number: 'Phone',
  state: 'State',
  district: 'District',
  address: 'Address',
  email: 'Email',
  pincode: 'Pincode',
  gender: 'Gender',
  occupation: 'Occupation',
  age: 'Age',
  annual_income: 'Annual income',
  annualIncome: 'Annual income',
  caste_category: 'Caste category',
  casteCategory: 'Caste category',
  preferred_language: 'Preferred language',
  preferredLanguage: 'Preferred language',
  bpl_cardholder: 'BPL cardholder',
  bplCardholder: 'BPL cardholder',
};

function ApplicationDetailView({ application }: { application: ApplicationDetailItem }) {
  const { t } = useLanguage();
  const profile = application.profile_snapshot ?? {};
  const docs = application.documents_snapshot ?? [];
  const profileEntries = Object.entries(profile).filter(
    ([k]) => !['user_id', 'updated_at'].includes(k) && profile[k] != null && String(profile[k]).trim() !== ''
  );

  return (
    <div className="space-y-6">
      <Link
        to="/applications"
        className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to My Applications
      </Link>

      <div className="bg-surface-card rounded-card shadow border border-surface-border overflow-hidden">
        <div className="px-6 py-4 border-b border-surface-border flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-text-primary">
              {application.job_title || application.scheme_name || application.scheme_code || application.scheme_id}
            </h1>
            <p className="text-sm text-text-muted mt-1">
              Reference: <span className="font-mono font-medium">{application.application_id}</span>
              {' · '}
              <span className="capitalize">{application.status}</span>
              {application.created_at && (
                <> · Submitted {new Date(application.created_at).toLocaleDateString()}</>
              )}
            </p>
          </div>
        </div>

        {profileEntries.length > 0 && (
          <div className="px-6 py-4 border-b border-surface-border">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
              <User className="w-4 h-4" />
              Application details (profile at time of submission)
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {profileEntries.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-text-muted font-medium">
                    {PROFILE_LABELS[key] ?? key.replace(/_/g, ' ')}
                  </dt>
                  <dd className="text-text-primary">
                    {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {docs.length > 0 && (
          <div className="px-6 py-4">
            <h2 className="text-sm font-semibold text-text-primary flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4" />
              Documents used
            </h2>
            <ul className="space-y-2 text-sm">
              {docs.map((d, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-surface-border bg-surface-bg px-3 py-2"
                >
                  <span className="font-medium text-text-primary capitalize">
                    {(d.documentType ?? 'document').replace(/_/g, ' ')}
                  </span>
                  <span className="text-text-muted text-xs capitalize">{d.status ?? '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {application.missing_documents && application.missing_documents.length > 0 && (
          <div className="px-6 py-4 border-t border-surface-border bg-amber-50/50">
            <p className="text-xs text-amber-800">
              Missing at submission: {application.missing_documents.join(', ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ApplicationsPage() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const detailId = searchParams.get('id');

  const { data: applications = [], isLoading } = useQuery('applications', () => fetchApplications(), {
    enabled: !detailId,
  });
  const { data: applicationDetail, isLoading: isLoadingDetail } = useQuery(
    ['application', detailId],
    () => (detailId ? fetchApplicationDetail(detailId) : Promise.resolve(null)),
    { enabled: !!detailId }
  );

  const summary = useMemo(() => {
    const submitted = applications.filter((a) => a.status === 'submitted').length;
    const pending = applications.filter((a) => a.status === 'pending' || a.status === 'pending_documents' || a.status === 'interested').length;
    const approved = applications.filter((a) => a.status === 'approved').length;
    const rejected = applications.filter((a) => a.status === 'rejected').length;
    return { submitted, pending, approved, rejected };
  }, [applications]);

  const latest = applications[0];

  if (detailId) {
    if (isLoadingDetail) return <Spinner />;
    if (!applicationDetail)
      return (
        <div className="space-y-4">
          <Link to="/applications" className="text-primary-600 hover:underline text-sm">Back to applications</Link>
          <p className="text-text-muted">Application not found.</p>
        </div>
      );
    return <ApplicationDetailView application={applicationDetail} />;
  }

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
            Latest: {latest.application_id} - {latest.job_title || latest.scheme_name || latest.scheme_code || latest.scheme_id} ({latest.status})
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
