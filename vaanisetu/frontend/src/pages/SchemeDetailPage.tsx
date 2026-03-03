import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { fetchSchemeDetail, fetchProfile, type SchemeDetail } from '../services/api';
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

interface EligibilityCheck {
  eligible: boolean;
  matchReasons: string[];
  exclusionReasons: string[];
}

/** Lightweight client-side eligibility check (mirrors backend evaluateEligibility) */
function checkEligibility(criteria: Record<string, unknown>, profile: Record<string, unknown>): EligibilityCheck {
  const matchReasons: string[] = [];
  const exclusionReasons: string[] = [];

  const userGender = String(profile.gender || '').trim().toLowerCase();
  const userCaste = String(profile.casteCategory || profile.caste_category || '').trim().toUpperCase();
  const userAge = Number(profile.age ?? 0);
  const userIncome = Number(profile.annualIncome ?? profile.annual_income ?? 0);
  const userBpl = profile.bplCardholder ?? profile.bpl_cardholder;

  // Caste/Gender gate with genderOrCaste OR-logic
  const casteCats = (criteria.casteCategories as string[] | undefined) ?? [];
  if (casteCats.length) {
    const inCaste = userCaste && casteCats.map(c => c.toUpperCase()).includes(userCaste);
    const isFemale = userGender === 'female' || userGender === 'f';
    if (criteria.genderOrCaste) {
      if (inCaste || isFemale) {
        matchReasons.push(inCaste ? `${userCaste} category eligible` : 'Women entrepreneur eligible');
      } else if (userCaste || userGender) {
        exclusionReasons.push(`Requires SC/ST category or Women — not applicable for ${userCaste || userGender} applicants`);
        return { eligible: false, matchReasons, exclusionReasons };
      }
    } else {
      if (inCaste) { matchReasons.push(`${userCaste} category eligible`); }
      else if (userCaste) {
        exclusionReasons.push(`Requires ${casteCats.join('/')} category (your category: ${userCaste})`);
        return { eligible: false, matchReasons, exclusionReasons };
      }
    }
  }

  // Gender-only gate
  const reqGender = String(criteria.gender || '').toLowerCase();
  if (!casteCats.length && reqGender && reqGender !== 'all' && reqGender !== 'any') {
    if (userGender === reqGender || userGender === reqGender[0]) {
      matchReasons.push(`${reqGender} eligibility matched`);
    } else if (userGender) {
      exclusionReasons.push(`This scheme requires ${reqGender} applicants`);
      return { eligible: false, matchReasons, exclusionReasons };
    }
  }

  // Age gate
  const ageMin = criteria.ageMin != null ? Number(criteria.ageMin) : null;
  const ageMax = criteria.ageMax != null ? Number(criteria.ageMax) : null;
  if ((ageMin != null || ageMax != null) && userAge > 0) {
    const okMin = ageMin == null || userAge >= ageMin;
    const okMax = ageMax == null || userAge <= ageMax;
    if (okMin && okMax) {
      matchReasons.push(`Age ${userAge} within eligibility`);
    } else {
      exclusionReasons.push(okMin ? `Age ${userAge} exceeds max ${ageMax}` : `Age ${userAge} below min ${ageMin}`);
      return { eligible: false, matchReasons, exclusionReasons };
    }
  }

  // Income gate
  const incomeMax = criteria.incomeMax != null ? Number(criteria.incomeMax) : null;
  if (incomeMax != null && userIncome > 0) {
    if (userIncome <= incomeMax) { matchReasons.push(`Income within ₹${incomeMax.toLocaleString('en-IN')} limit`); }
    else {
      exclusionReasons.push(`Income ₹${userIncome.toLocaleString('en-IN')} exceeds limit ₹${incomeMax.toLocaleString('en-IN')}`);
      return { eligible: false, matchReasons, exclusionReasons };
    }
  }

  // BPL gate
  if (criteria.bpl === true) {
    if (userBpl === true) { matchReasons.push('BPL cardholder eligible'); }
    else if (userBpl === false) {
      exclusionReasons.push('Requires BPL card');
      return { eligible: false, matchReasons, exclusionReasons };
    }
  }

  if (matchReasons.length === 0 && exclusionReasons.length === 0) {
    matchReasons.push('Open to all eligible applicants');
  }
  return { eligible: exclusionReasons.length === 0, matchReasons, exclusionReasons };
}

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
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null);

  useEffect(() => {
    if (!schemeId) return;
    setLoading(true);
    fetchSchemeDetail(schemeId)
      .then((res) => {
        const s = res?.data?.scheme ?? null;
        setScheme(s);
        setError(null);
        // Fetch user profile for eligibility check
        if (s?.eligibilityCriteria) {
          fetchProfile().then(profileRes => {
            const profile = (profileRes as any)?.data?.profile ?? {};
            if (Object.keys(profile).length > 0) {
              setEligibility(checkEligibility(s.eligibilityCriteria!, profile));
            }
          }).catch(() => { /* non-fatal */ });
        }
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
          {eligibility ? (
            <>
              <div className={`flex items-center gap-2 mb-3 font-semibold text-sm ${eligibility.eligible ? 'text-green-700' : 'text-red-600'}`}>
                <span>{eligibility.eligible ? '✅ You may be eligible' : '❌ You may not be eligible'}</span>
              </div>
              {eligibility.matchReasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {eligibility.matchReasons.map((r, i) => (
                    <span key={i} className="inline-flex items-center text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-2 py-0.5">✓ {r}</span>
                  ))}
                </div>
              )}
              {eligibility.exclusionReasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {eligibility.exclusionReasons.map((r, i) => (
                    <span key={i} className="inline-flex items-center text-xs bg-red-50 text-red-700 border border-red-200 rounded-full px-2 py-0.5">✗ {r}</span>
                  ))}
                </div>
              )}
              {scheme?.eligibilityCriteria && (scheme.eligibilityCriteria as any).eligibility_summary_en && (
                <p className="text-xs text-text-muted mt-2 italic">{(scheme.eligibilityCriteria as any).eligibility_summary_en}</p>
              )}
            </>
          ) : (
            <div className="space-y-1 text-sm text-text-secondary">
              {scheme?.eligibilityCriteria ? (
                <>
                  {(scheme.eligibilityCriteria as any).casteCategories?.length > 0 && (
                    <p>Category: {(scheme.eligibilityCriteria as any).casteCategories.join(', ')}</p>
                  )}
                  {(scheme.eligibilityCriteria as any).gender && (scheme.eligibilityCriteria as any).gender !== 'any' && (
                    <p>Gender: {(scheme.eligibilityCriteria as any).gender}</p>
                  )}
                  {(scheme.eligibilityCriteria as any).ageMin && (
                    <p>Age: {(scheme.eligibilityCriteria as any).ageMin}–{(scheme.eligibilityCriteria as any).ageMax ?? '∞'} years</p>
                  )}
                  {(scheme.eligibilityCriteria as any).incomeMax && (
                    <p>Income: up to ₹{Number((scheme.eligibilityCriteria as any).incomeMax).toLocaleString('en-IN')}/year</p>
                  )}
                  {(scheme.eligibilityCriteria as any).eligibility_summary_en && (
                    <p className="italic text-text-muted">{(scheme.eligibilityCriteria as any).eligibility_summary_en}</p>
                  )}
                </>
              ) : (
                <p>Check the scheme criteria on the official portal.</p>
              )}
              <p className="text-xs text-text-muted mt-2">Update your profile for a personalised eligibility check.</p>
            </div>
          )}
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
