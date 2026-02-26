import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchSchemeDetail, type SchemeDetail } from '../services/api';
import Button from '../components/Common/Button';
import { SkeletonCard } from '../components/Common/Skeleton';
import ApplicationForm from '../components/Schemes/ApplicationForm';
import { useLanguage } from '../contexts/LanguageContext';

const CATEGORY_KEYS: Record<string, string> = {
  agriculture: 'schemes.agriculture',
  financial_inclusion: 'schemes.financial_inclusion',
  health: 'schemes.health',
  housing: 'schemes.housing',
  education: 'schemes.education',
  social_welfare: 'schemes.social_welfare',
  employment: 'schemes.employment',
};

export default function SchemeDetailPage() {
  const { schemeId } = useParams<{ schemeId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const actionApply = searchParams.get('action') === 'apply';

  const [scheme, setScheme] = useState<SchemeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showApplyModal, setShowApplyModal] = useState(actionApply);

  useEffect(() => {
    if (!schemeId) return;
    setLoading(true);
    fetchSchemeDetail(schemeId)
      .then((res) => {
        setScheme(res?.data?.scheme ?? null);
        setError(null);
      })
      .catch(() => {
        setError(t('schemes.scheme_not_found'));
        setScheme(null);
      })
      .finally(() => setLoading(false));
  }, [schemeId, t]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-48" />
        <SkeletonCard />
      </div>
    );
  }

  if (error || !scheme) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-card p-8 text-center">
        <p className="text-text-secondary mb-4">{error ?? t('schemes.scheme_not_found')}</p>
        <Button onClick={() => navigate('/schemes')}>{t('schemes.back_to_schemes')}</Button>
      </div>
    );
  }

  const categoryLabel = scheme.category ? (CATEGORY_KEYS[scheme.category] ? t(CATEGORY_KEYS[scheme.category]) : scheme.category) : '';
  const docsRequired = scheme.documentsRequired ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => navigate('/schemes')}
          className="text-primary-600 hover:text-primary-700 font-medium text-sm flex items-center gap-1"
        >
          ← {t('schemes.back_to_schemes')}
        </button>
        <Button size="lg" onClick={() => setShowApplyModal(true)}>
          {t('schemes.apply_now')}
        </Button>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {categoryLabel && (
            <span className="text-xs font-medium px-2 py-1 rounded-full bg-secondary-100 text-secondary-700">
              {categoryLabel}
            </span>
          )}
        </div>
        <h1 className="font-display text-2xl font-bold text-text-primary">{scheme.nameEn}</h1>
        {scheme.nameHi && (
          <p className="text-lg text-text-secondary mt-1">{scheme.nameHi}</p>
        )}
        <p className="text-sm text-text-muted mt-2">
          {scheme.ministry} | {scheme.level === 'central' ? t('schemes.central') : t('schemes.state')} {t('schemes.scheme')}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
          <h2 className="font-display text-lg font-semibold text-text-primary mb-3">{t('schemes.what_you_get')}</h2>
          {(scheme.benefitAmountMin != null || scheme.benefitAmountMax != null) && (
            <p className="text-primary-600 font-semibold">
              ₹{scheme.benefitAmountMin ?? 0} – ₹{scheme.benefitAmountMax ?? 0}
              {scheme.benefitType === 'loan' && ' loan'}
              {scheme.benefitType === 'subsidy' && ' subsidy'}
              {scheme.benefitType === 'grant' && ' grant'}
            </p>
          )}
          <p className="text-sm text-text-secondary mt-2">{scheme.description}</p>
        </div>
        <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
          <h2 className="font-display text-lg font-semibold text-text-primary mb-3">{t('eligibility.title')}</h2>
          <p className="text-sm text-text-secondary">
            Check the scheme criteria on the official portal. This scheme is open for enrollment.
          </p>
        </div>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
        <h2 className="font-display text-lg font-semibold text-text-primary mb-3">{t('schemes.documents_required')}</h2>
        <ul className="space-y-2">
          {docsRequired.length === 0 ? (
            <li className="text-text-muted text-sm">Aadhaar, bank account details may be required.</li>
          ) : (
            docsRequired.map((doc) => (
              <li key={doc} className="flex items-center gap-2 text-text-secondary text-sm">
                <span className="text-amber-800">⚠️</span> {doc.replace(/_/g, ' ')}
              </li>
            ))
          )}
        </ul>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate('/documents')}>
          {t('schemes.upload_documents')}
        </Button>
      </div>

      {scheme.description && (
        <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
          <h2 className="font-display text-lg font-semibold text-text-primary mb-2">{t('schemes.about_scheme')}</h2>
          <p className="text-text-secondary text-sm whitespace-pre-wrap">{scheme.description}</p>
        </div>
      )}

      {scheme.applicationUrl && (
        <p className="text-sm text-text-muted">
          Official portal: <a href={scheme.applicationUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">{scheme.applicationUrl}</a>
        </p>
      )}

      <div className="flex justify-center">
        <Button size="lg" onClick={() => setShowApplyModal(true)}>
          {t('schemes.apply_now')}
        </Button>
      </div>

      {showApplyModal && schemeId && (
        <ApplicationForm
          schemeId={schemeId}
          schemeName={scheme.nameEn ?? scheme.schemeId}
          documentsRequired={docsRequired}
          onClose={() => setShowApplyModal(false)}
          onSuccess={() => {
            setShowApplyModal(false);
            navigate('/applications');
          }}
        />
      )}
    </div>
  );
}
