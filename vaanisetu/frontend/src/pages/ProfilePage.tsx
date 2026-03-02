import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchProfile, updateProfile } from '../services/api';
import Button from '../components/Common/Button';
import Input from '../components/Common/Input';
import { SkeletonCard } from '../components/Common/Skeleton';
import { showToast } from '../components/Common/Toast';
import { useLanguage } from '../contexts/LanguageContext';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी' },
  { value: 'ta', label: 'தமிழ்' },
  { value: 'te', label: 'తెలుగు' },
  { value: 'mr', label: 'मराठी' },
  { value: 'kn', label: 'ಕನ್ನಡ' },
];

const OCCUPATION_KEYS = ['eligibility.farmer', 'eligibility.self_employed', 'eligibility.student', 'eligibility.salaried', 'eligibility.unemployed', 'eligibility.homemaker'] as const;
const OCCUPATIONS = ['Farmer', 'Self-employed', 'Student', 'Salaried', 'Unemployed', 'Homemaker'];
const CASTE_OPTIONS = ['General', 'OBC', 'SC', 'ST', 'EWS'];

export default function ProfilePage() {
  const { user } = useAuth();
  const { t, setLanguage } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    age: '' as number | '',
    gender: '',
    state: '',
    district: '',
    preferredLanguage: 'en',
    occupation: '',
    annualIncome: '' as number | '',
    casteCategory: '',
    bplCardholder: false,
  });

  useEffect(() => {
    fetchProfile()
      .then((res) => {
        const p = (res?.data?.profile ?? {}) as Record<string, unknown>;
        setForm({
          fullName: (p.fullName ?? p.name ?? user?.name ?? '') as string,
          phone: (p.phone ?? user?.phone ?? '') as string,
          age: (p.age as number) ?? '',
          gender: (p.gender as string) ?? '',
          state: (p.state as string) ?? '',
          district: (p.district as string) ?? '',
          preferredLanguage: ((p.preferredLanguage ?? p.preferred_language) as string) ?? 'en',
          occupation: (p.occupation as string) ?? '',
          annualIncome: ((p.annualIncome ?? p.annual_income) as number) ?? '',
          casteCategory: ((p.casteCategory ?? p.caste_category) as string) ?? '',
          bplCardholder: !!(p.bplCardholder ?? p.bpl_cardholder),
        });
        const pref = ((p.preferredLanguage ?? p.preferred_language) as string) ?? '';
        if (pref && ['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(pref)) {
          setLanguage(pref as any);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.name, user?.phone]);

  const filled = [
    form.fullName,
    form.phone,
    form.age !== '',
    form.gender,
    form.state,
    form.district,
    form.occupation,
    form.annualIncome !== '',
    form.casteCategory,
  ].filter(Boolean).length;
  const completion = Math.round((filled / 9) * 100);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({
        fullName: form.fullName,
        name: form.fullName,
        phone: form.phone,
        age: form.age === '' ? undefined : Number(form.age),
        gender: form.gender || undefined,
        state: form.state || undefined,
        district: form.district || undefined,
        preferredLanguage: form.preferredLanguage,
        occupation: form.occupation || undefined,
        annualIncome: form.annualIncome === '' ? undefined : Number(form.annualIncome),
        casteCategory: form.casteCategory || undefined,
        bplCardholder: form.bplCardholder,
      });
      if (['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(form.preferredLanguage)) {
        setLanguage(form.preferredLanguage as any);
      }
      showToast(t('profile.saved'), 'success');
    } catch {
      showToast(t('profile.save_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div className="skeleton h-8 w-48" />
        <SkeletonCard />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="font-display text-2xl font-bold text-text-primary">{t('profile.title')}</h1>

      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-400 to-secondary-500 flex items-center justify-center text-2xl font-bold text-white font-display">
            {form.fullName?.charAt(0) ?? user?.name?.charAt(0) ?? 'U'}
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-text-primary">{form.fullName || user?.name || 'User'}</h2>
            <p className="text-text-muted text-sm">{form.phone || user?.phone || '—'}</p>
          </div>
        </div>
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-text-secondary">{t('profile.completion')} {completion}%</span>
          </div>
          <div className="h-2 bg-surface-border rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
          {completion < 100 && (
            <p className="text-xs text-text-muted mt-1">{t('profile.missing_hint')}</p>
          )}
        </div>
      </div>

      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card space-y-4">
        <Input
          label={t('profile.full_name')}
          value={form.fullName}
          onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
        />
        <Input
          label={t('profile.phone_readonly')}
          value={form.phone}
          readOnly
        />
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('profile.age')}</label>
          <input
            type="number"
            min={18}
            max={120}
            value={form.age === '' ? '' : form.age}
            onChange={(e) => setForm((f) => ({ ...f, age: e.target.value === '' ? '' : parseInt(e.target.value, 10) }))}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('profile.gender')}</label>
          <div className="flex gap-2 flex-wrap">
            {['M', 'F', 'Other'].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setForm((f) => ({ ...f, gender: g }))}
                className={`px-4 py-2 rounded-full text-sm font-medium border-2 ${
                  form.gender === g ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <Input
          label={t('profile.state')}
          value={form.state}
          onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
        />
        <Input
          label={t('profile.district')}
          value={form.district}
          onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
        />
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('profile.language')}</label>
          <div className="flex gap-2 flex-wrap">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.value}
                type="button"
                onClick={() => setForm((f) => ({ ...f, preferredLanguage: lang.value }))}
                className={`px-3 py-2 rounded-full text-sm border-2 ${
                  form.preferredLanguage === lang.value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('profile.occupation')}</label>
          <div className="flex gap-2 flex-wrap">
            {OCCUPATIONS.map((occ, idx) => (
              <button
                key={occ}
                type="button"
                onClick={() => setForm((f) => ({ ...f, occupation: occ.toLowerCase().replace(/\s+/g, '_') }))}
                className={`px-3 py-2 rounded-full text-sm border-2 ${
                  form.occupation === occ.toLowerCase().replace(/\s+/g, '_') ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                }`}
              >
                {t(OCCUPATION_KEYS[idx])}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-1">{t('profile.income')}</label>
          <input
            type="number"
            min={0}
            value={form.annualIncome === '' ? '' : form.annualIncome}
            onChange={(e) => setForm((f) => ({ ...f, annualIncome: e.target.value === '' ? '' : parseInt(e.target.value, 10) }))}
            className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">{t('profile.caste')}</label>
          <div className="flex gap-2 flex-wrap">
            {CASTE_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, casteCategory: c }))}
                className={`px-3 py-2 rounded-full text-sm border-2 ${
                  form.casteCategory === c ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.bplCardholder}
            onChange={(e) => setForm((f) => ({ ...f, bplCardholder: e.target.checked }))}
            className="rounded border-surface-border"
          />
          <span className="text-sm text-text-primary">{t('profile.bpl')}</span>
        </label>

        <Button onClick={handleSave} disabled={saving} className="mt-4">
          {saving ? t('common.loading') : t('profile.save')}
        </Button>
      </div>
    </div>
  );
}
