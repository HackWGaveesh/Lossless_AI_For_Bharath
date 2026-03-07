import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../Common/Button';
import { SkeletonCard } from '../Common/Skeleton';
import { fetchProfile, searchSchemes, updateProfile } from '../../services/api';
import type { Scheme } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const CASTE_OPTIONS = ['General', 'OBC', 'SC', 'ST', 'EWS'];
const OCCUPATIONS = ['farmer', 'agricultural_laborer', 'self_employed', 'student', 'salaried', 'unemployed', 'homemaker'] as const;

export interface EligibilityFormData {
  age?: number;
  gender?: string;
  state?: string;
  district?: string;
  annualIncome?: number;
  casteCategory?: string;
  occupation?: string;
  bplCardholder?: boolean;
}

const initialForm: EligibilityFormData = {};

function toUserProfile(form: EligibilityFormData): Record<string, unknown> {
  return {
    age: form.age,
    gender: form.gender,
    state: form.state,
    district: form.district,
    annualIncome: form.annualIncome,
    casteCategory: form.casteCategory,
    occupation: form.occupation,
    bplCardholder: form.bplCardholder,
  };
}

function mergeProfileIntoForm(current: EligibilityFormData, profile: EligibilityFormData): EligibilityFormData {
  const next = { ...current };
  (Object.keys(profile) as Array<keyof EligibilityFormData>).forEach((key) => {
    const currentValue = next[key];
    const profileValue = profile[key];
    if (
      (currentValue === undefined || currentValue === '' || currentValue === null)
      && profileValue !== undefined
      && profileValue !== ''
      && profileValue !== null
    ) {
      (next as Record<keyof EligibilityFormData, EligibilityFormData[keyof EligibilityFormData] | undefined>)[key] = profileValue;
    }
  });
  return next;
}

function countFilledFields(form: EligibilityFormData) {
  return Object.values(form).filter((value) => value !== undefined && value !== '' && value !== null).length;
}

export default function EligibilityCalculator() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [form, setForm] = useState<EligibilityFormData>(initialForm);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [results, setResults] = useState<(Scheme & { eligibilityScore?: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOptional, setShowOptional] = useState(false);
  const [prefilledCount, setPrefilledCount] = useState(0);

  useEffect(() => {
    let active = true;

    fetchProfile()
      .then((res) => {
        if (!active) return;
        const profile = (res?.data?.profile ?? {}) as Record<string, unknown>;
        const prefill: EligibilityFormData = {
          age: typeof profile.age === 'number' ? profile.age : undefined,
          gender: typeof profile.gender === 'string' ? profile.gender : undefined,
          state: typeof profile.state === 'string' ? profile.state : undefined,
          district: typeof profile.district === 'string' ? profile.district : undefined,
          annualIncome: typeof profile.annualIncome === 'number'
            ? profile.annualIncome
            : typeof profile.annual_income === 'number'
              ? Number(profile.annual_income)
              : undefined,
          casteCategory: typeof profile.casteCategory === 'string'
            ? profile.casteCategory
            : typeof profile.caste_category === 'string'
              ? profile.caste_category
              : undefined,
          occupation: typeof profile.occupation === 'string' ? profile.occupation : undefined,
          bplCardholder: typeof profile.bplCardholder === 'boolean'
            ? profile.bplCardholder
            : typeof profile.bpl_cardholder === 'boolean'
              ? profile.bpl_cardholder
              : undefined,
        };

        setPrefilledCount(countFilledFields(prefill));
        setForm((current) => mergeProfileIntoForm(current, prefill));
        if (prefill.district || prefill.casteCategory || prefill.occupation || prefill.bplCardholder !== undefined) {
          setShowOptional(true);
        }
      })
      .catch(() => {
        if (active) setPrefilledCount(0);
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const update = (key: keyof EligibilityFormData, value: EligibilityFormData[keyof EligibilityFormData]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setError(null);
  };

  const canSubmit = useMemo(() => (
    form.age != null
    && form.age >= 18
    && form.age <= 120
    && !!form.gender
    && !!form.state
    && form.annualIncome != null
  ), [form.age, form.annualIncome, form.gender, form.state]);

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchSchemes(toUserProfile(form), '');
      const schemes = (res?.data?.schemes ?? []) as (Scheme & { eligibilityScore?: number })[];
      setResults(schemes);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    try {
      await updateProfile(toUserProfile(form));
    } catch {
      setError(t('profile.save_error'));
    } finally {
      setLoading(false);
    }
  };

  if (results !== null && !loading) {
    return (
      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
        <h3 className="font-display text-xl font-semibold text-text-primary mb-4">{t('eligibility.results_title')}</h3>
        <div className="space-y-4 mb-6">
          {results.length === 0 ? (
            <p className="text-text-secondary">{t('eligibility.no_results')}</p>
          ) : (
            results.slice(0, 10).map((scheme) => (
              <div
                key={scheme.schemeId}
                className="rounded-xl border border-surface-border p-4 hover:shadow-card-hover transition-all"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-secondary-100 text-secondary-700">
                    {scheme.category ?? 'Scheme'}
                  </span>
                  {scheme.eligibilityScore != null ? (
                    <span className="text-sm font-semibold text-primary-500">
                      {Math.round(scheme.eligibilityScore)}% Match
                    </span>
                  ) : null}
                </div>
                <h4 className="font-display font-semibold text-text-primary">{scheme.nameEn ?? scheme.schemeId}</h4>
                {scheme.nameHi ? <p className="text-sm text-text-secondary">{scheme.nameHi}</p> : null}
                {(scheme.benefitAmountMin != null || scheme.benefitAmountMax != null) ? (
                  <p className="text-sm text-primary-600 font-medium mt-1">
                    Rs {scheme.benefitAmountMin ?? 0} - Rs {scheme.benefitAmountMax ?? 0}
                  </p>
                ) : null}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => navigate(`/schemes/${scheme.schemeId}`)}>
                    {t('schemes.view_details')} & {t('schemes.apply_now')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" onClick={() => setResults(null)}>
            {t('eligibility.refine')}
          </Button>
          <Button variant="secondary" onClick={handleSaveProfile} disabled={loading}>
            {t('eligibility.save_profile')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="font-display text-xl font-semibold text-text-primary mb-2">{t('schemes.find_for_you')}</h3>
          <p className="text-sm text-text-secondary">
            4 key questions are required. You can add up to 4 more filters if you want tighter matches.
          </p>
        </div>
        <div className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 min-w-[220px]">
          <div className="text-[11px] uppercase tracking-[0.18em] text-primary-700 font-semibold">Profile Assist</div>
          <div className="text-2xl font-display font-semibold text-primary-800">
            {profileLoading ? '...' : prefilledCount}
          </div>
          <div className="text-xs text-primary-700">
            {profileLoading ? 'Checking your saved profile...' : 'answers filled from saved profile'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('eligibility.age')}</label>
          <input
            type="number"
            min={18}
            max={120}
            value={form.age ?? ''}
            onChange={(e) => update('age', e.target.value ? parseInt(e.target.value, 10) : undefined)}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('eligibility.gender')}</label>
          <div className="flex gap-2 flex-wrap">
            {['M', 'F', 'Other'].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => update('gender', g)}
                className={`px-4 py-2 rounded-full text-sm font-medium border-2 transition-colors ${
                  form.gender === g ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border bg-surface-card text-text-secondary hover:border-primary-300'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('eligibility.state')}</label>
          <select
            value={form.state ?? ''}
            onChange={(e) => update('state', e.target.value || undefined)}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
          >
            <option value="">Select state</option>
            {INDIAN_STATES.map((state) => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('eligibility.income')}</label>
          <input
            type="number"
            min={0}
            value={form.annualIncome ?? ''}
            onChange={(e) => update('annualIncome', e.target.value ? parseInt(e.target.value, 10) : undefined)}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
            placeholder="e.g. 150000"
          />
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-surface-border bg-surface-elevated p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">Optional filters</div>
            <div className="text-xs text-text-muted">District, caste, occupation, and BPL can improve ranking, but they are not mandatory.</div>
          </div>
          <button
            type="button"
            onClick={() => setShowOptional((value) => !value)}
            className="text-sm font-medium text-primary-600"
          >
            {showOptional ? 'Hide extra filters' : 'Add more filters'}
          </button>
        </div>

        {showOptional ? (
          <div className="grid gap-4 md:grid-cols-2 mt-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">{t('eligibility.district')}</label>
              <input
                type="text"
                value={form.district ?? ''}
                onChange={(e) => update('district', e.target.value || undefined)}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
                placeholder="District"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">{t('eligibility.caste')}</label>
              <div className="flex flex-wrap gap-2">
                {CASTE_OPTIONS.map((caste) => (
                  <button
                    key={caste}
                    type="button"
                    onClick={() => update('casteCategory', caste)}
                    className={`px-3 py-2 rounded-full text-sm border-2 ${
                      form.casteCategory === caste ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                    }`}
                  >
                    {caste}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">{t('eligibility.occupation')}</label>
              <div className="flex flex-wrap gap-2">
                {OCCUPATIONS.map((occupation) => (
                  <button
                    key={occupation}
                    type="button"
                    onClick={() => update('occupation', occupation)}
                    className={`px-3 py-2 rounded-full text-sm border-2 ${
                      form.occupation === occupation ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                    }`}
                  >
                    {t(`eligibility.${occupation}`)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">{t('eligibility.bpl')}</label>
              <div className="flex gap-2">
                {[true, false].map((value) => (
                  <button
                    key={String(value)}
                    type="button"
                    onClick={() => update('bplCardholder', value)}
                    className={`px-4 py-2 rounded-full text-sm border-2 ${
                      form.bplCardholder === value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                    }`}
                  >
                    {value ? t('eligibility.yes') : t('eligibility.no')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3 mt-6">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : null}
      {error ? <p className="text-red-700 text-sm mt-3">{error}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-8">
        <div className="text-sm text-text-muted">
          Search works with the 4 core questions. Optional filters only improve ranking.
        </div>
        <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
          {t('eligibility.calculate')}
        </Button>
      </div>
    </div>
  );
}
