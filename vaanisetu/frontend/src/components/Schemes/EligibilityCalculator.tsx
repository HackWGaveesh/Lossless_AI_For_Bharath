import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../Common/Button';
import { SkeletonCard } from '../Common/Skeleton';
import { searchSchemes, updateProfile } from '../../services/api';
import type { Scheme } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

export interface EligibilityFormData {
  age?: number;
  gender?: string;
  state?: string;
  district?: string;
  annualIncome?: number;
  bplCardHolder?: boolean;
  landOwnership?: string;
  hasBankAccount?: boolean;
  casteCategory?: string;
  disabilityStatus?: string;
  isWidowWidower?: boolean;
  isMinority?: boolean;
  occupation?: string;
  farmingType?: string;
  studentLevel?: string;
}

const initialForm: EligibilityFormData = {};

function toUserProfile(form: EligibilityFormData): Record<string, unknown> {
  return {
    age: form.age,
    gender: form.gender,
    state: form.state,
    district: form.district,
    annualIncome: form.annualIncome,
    bplCardHolder: form.bplCardHolder,
    landOwnership: form.landOwnership,
    hasBankAccount: form.hasBankAccount,
    casteCategory: form.casteCategory,
    disabilityStatus: form.disabilityStatus,
    isWidowWidower: form.isWidowWidower,
    isMinority: form.isMinority,
    occupation: form.occupation,
    farmingType: form.farmingType,
    studentLevel: form.studentLevel,
  };
}

export default function EligibilityCalculator() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<EligibilityFormData>(initialForm);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<(Scheme & { eligibilityScore?: number })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (key: keyof EligibilityFormData, value: unknown) => {
    setForm((p) => ({ ...p, [key]: value }));
    setError(null);
  };

  const canProceedStep1 = form.age != null && form.age >= 18 && form.age <= 80 && form.gender && form.state && form.district;
  const canProceedStep2 = form.annualIncome != null && form.hasBankAccount != null;
  const canProceedStep3 = true;
  const canProceedStep4 = !!form.occupation;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const profile = toUserProfile(form);
      const res = await searchSchemes(profile, '');
      const schemes = (res?.data?.schemes ?? []) as (Scheme & { eligibilityScore?: number })[];
      setResults(schemes);
    } catch (e) {
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

  const stepDots = (
    <div className="flex items-center justify-center gap-2 mb-8">
      {[1, 2, 3, 4].map((s) => (
        <Fragment key={s}>
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
              step > s ? 'bg-accent-500 border-accent-500 text-white' : step === s ? 'bg-primary-500 border-primary-500 text-white' : 'border-surface-border bg-surface-card text-text-muted'
            }`}
          >
            {step > s ? '✓' : s}
          </div>
          {s < 4 && <div className={`w-8 h-0.5 ${step > s ? 'bg-accent-500' : 'bg-surface-border'}`} />}
        </Fragment>
      ))}
    </div>
  );

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
                  {scheme.eligibilityScore != null && (
                    <span className="text-sm font-semibold text-primary-500">
                      {Math.round(scheme.eligibilityScore)}% Match
                    </span>
                  )}
                </div>
                <h4 className="font-display font-semibold text-text-primary">{scheme.nameEn ?? scheme.schemeId}</h4>
                {scheme.nameHi && <p className="text-sm text-text-secondary">{scheme.nameHi}</p>}
                {(scheme.benefitAmountMin != null || scheme.benefitAmountMax != null) && (
                  <p className="text-sm text-primary-600 font-medium mt-1">
                    ₹{scheme.benefitAmountMin ?? 0} – ₹{scheme.benefitAmountMax ?? 0}
                  </p>
                )}
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
          <Button variant="outline" onClick={() => { setResults(null); setStep(1); }}>
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
      <h3 className="font-display text-xl font-semibold text-text-primary mb-2">{t('schemes.find_for_you')}</h3>
      <p className="text-sm text-text-secondary mb-6">{t('eligibility.subtitle')}</p>

      {stepDots}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Age (18–80)</label>
            <input
              type="number"
              min={18}
              max={80}
              value={form.age ?? ''}
              onChange={(e) => update('age', e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Gender</label>
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
            <label className="block text-sm font-medium text-text-primary mb-1">State</label>
            <select
              value={form.state ?? ''}
              onChange={(e) => update('state', e.target.value || undefined)}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
            >
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">District</label>
            <input
              type="text"
              value={form.district ?? ''}
              onChange={(e) => update('district', e.target.value || undefined)}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
              placeholder="District"
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Annual family income (₹)</label>
            <input
              type="number"
              min={0}
              value={form.annualIncome ?? ''}
              onChange={(e) => update('annualIncome', e.target.value ? parseInt(e.target.value, 10) : undefined)}
              className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
              placeholder="e.g. 150000"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">BPL card holder?</label>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update('bplCardHolder', v)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border-2 ${
                    form.bplCardHolder === v ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Land ownership</label>
            <div className="flex flex-wrap gap-2">
              {['None', 'Less than 2 hectares', '2-5 hectares', 'More than 5 hectares'].map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => update('landOwnership', opt)}
                  className={`px-3 py-2 rounded-full text-sm border-2 ${
                    form.landOwnership === opt ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Owns a bank account?</label>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update('hasBankAccount', v)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border-2 ${
                    form.hasBankAccount === v ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Caste category</label>
            <div className="flex flex-wrap gap-2">
              {['General', 'OBC', 'SC', 'ST', 'EWS'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => update('casteCategory', c)}
                  className={`px-3 py-2 rounded-full text-sm border-2 ${
                    form.casteCategory === c ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Disability status</label>
            <div className="flex flex-wrap gap-2">
              {['None', 'Physically Disabled', 'Visually Impaired', 'Hearing Impaired'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => update('disabilityStatus', d)}
                  className={`px-3 py-2 rounded-full text-sm border-2 ${
                    form.disabilityStatus === d ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Widow / Widower?</label>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update('isWidowWidower', v)}
                  className={`px-4 py-2 rounded-full text-sm border-2 ${
                    form.isWidowWidower === v ? 'border-primary-500 bg-primary-50' : 'border-surface-border'
                  }`}
                >
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Minority?</label>
            <div className="flex gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => update('isMinority', v)}
                  className={`px-4 py-2 rounded-full text-sm border-2 ${
                    form.isMinority === v ? 'border-primary-500 bg-primary-50' : 'border-surface-border'
                  }`}
                >
                  {v ? 'Yes' : 'No'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Primary occupation</label>
            <div className="flex flex-wrap gap-2">
              {['Farmer', 'Agricultural Laborer', 'Self-employed', 'Salaried', 'Student', 'Unemployed', 'Homemaker'].map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => update('occupation', o.toLowerCase().replace(/\s+/g, '_'))}
                  className={`px-3 py-2 rounded-full text-sm border-2 ${
                    form.occupation === o.toLowerCase().replace(/\s+/g, '_') ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          {form.occupation === 'farmer' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Type of farming</label>
              <div className="flex flex-wrap gap-2">
                {['Subsistence', 'Commercial', 'Animal husbandry'].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => update('farmingType', f)}
                    className={`px-3 py-2 rounded-full text-sm border-2 ${
                      form.farmingType === f ? 'border-primary-500 bg-primary-50' : 'border-surface-border'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.occupation === 'student' && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Current level</label>
              <div className="flex flex-wrap gap-2">
                {['School', 'Undergraduate', 'Postgraduate'].map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => update('studentLevel', l)}
                    className={`px-3 py-2 rounded-full text-sm border-2 ${
                      form.studentLevel === l ? 'border-primary-500 bg-primary-50' : 'border-surface-border'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-3 mt-6">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      )}
      {error && <p className="text-red-700 text-sm mt-2">{error}</p>}

      <div className="flex justify-between mt-8">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
          {t('eligibility.previous')}
        </Button>
        {step < 4 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={
            (step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2) || (step === 3 && !canProceedStep3) || (step === 4 && !canProceedStep4)
          }>
            {t('eligibility.next')}
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={loading}>
            {t('eligibility.calculate')}
          </Button>
        )}
      </div>
    </div>
  );
}
