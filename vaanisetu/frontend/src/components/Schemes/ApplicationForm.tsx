import { useState, useEffect } from 'react';
import { createApplication, fetchProfile } from '../../services/api';
import Button from '../Common/Button';
import Input from '../Common/Input';
import { getApiUserId } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

interface ApplicationFormProps {
  schemeId: string;
  schemeName: string;
  documentsRequired: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function ApplicationForm({ schemeId, schemeName, documentsRequired, onClose, onSuccess }: ApplicationFormProps) {
  const userId = getApiUserId();
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    state: '',
    district: '',
    pincode: '',
    address: '',
  });
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refNumber, setRefNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile()
      .then((res) => {
        const p = (res?.data?.profile ?? {}) as Record<string, unknown>;
        setProfile(p);
        setForm({
          fullName: (p.fullName ?? p.name ?? '') as string,
          phone: (p.phone ?? '') as string,
          state: (p.state ?? '') as string,
          district: (p.district ?? '') as string,
          pincode: (p.pincode ?? '') as string,
          address: (p.address ?? '') as string,
        });
      })
      .catch(() => { })
      .finally(() => setLoadingProfile(false));
  }, []);

  const canProceedStep2 = form.fullName.trim() && form.state.trim() && form.district.trim();
  const canProceedStep3 = true;
  const canSubmitStep4 = declarationAccepted;

  const handleSubmit = async () => {
    if (!userId) {
      setError(t('auth.login_required'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await createApplication({
        userId,
        schemeId,
        schemeName,
        query: schemeName,
        idempotencyKey,
        formData: { ...form, ...profile },
      });
      let applicationId = (res?.data as { applicationId?: string })?.applicationId;
      if (!applicationId && (res as any)?.data?.needsConfirmation && (res as any)?.data?.confirmationToken) {
        const confirmRes = await createApplication({
          userId,
          schemeId,
          schemeName,
          query: schemeName,
          confirm: true,
          confirmationToken: (res as any).data.confirmationToken,
          idempotencyKey,
          formData: { ...form, ...profile },
        });
        applicationId = (confirmRes?.data as { applicationId?: string })?.applicationId;
      }
      setRefNumber(applicationId ?? 'APP-SUBMITTED');
      setStep(4);
    } catch (e) {
      setError(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (refNumber) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div className="bg-surface-card rounded-card shadow-card max-w-md w-full p-6 relative overflow-hidden">
          <div className="confetti-particles absolute inset-0 pointer-events-none" aria-hidden />
          <h2 className="font-display text-2xl font-bold text-text-primary text-center">{t('form.congratulations')}</h2>
          <p className="text-text-secondary text-center mt-2">{t('form.expected_decision')}</p>
          <div className="mt-6 p-4 bg-primary-50 rounded-lg border border-primary-200">
            <p className="text-sm text-text-secondary mb-1">{t('form.ref_number')}</p>
            <p className="font-mono text-lg font-bold text-primary-700 break-all">{refNumber}</p>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={onSuccess}>{t('form.track')}</Button>
            <Button variant="outline" onClick={onClose}>{t('form.close')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface-card rounded-card shadow-card max-w-lg w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-xl font-semibold text-text-primary">{t('schemes.apply_now')} — {schemeName}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        <div className="flex gap-2 mb-6">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full ${step >= s ? 'bg-primary-500' : 'bg-surface-border'}`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            {loadingProfile ? (
              <p className="text-text-muted text-sm">{t('common.loading')}</p>
            ) : (
              <p className="text-sm text-text-secondary">{t('form.prefilled')}</p>
            )}
            <Input
              label={t('profile.full_name')}
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder={t('profile.full_name')}
            />
            <Input
              label={t('profile.phone_readonly')}
              value={form.phone}
              readOnly
              placeholder={t('profile.phone_readonly')}
            />
            <Input
              label={t('eligibility.state')}
              value={form.state}
              onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              placeholder={t('eligibility.state')}
            />
            <Input
              label={t('eligibility.district')}
              value={form.district}
              onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              placeholder={t('eligibility.district')}
            />
            <Input
              label="Pincode"
              value={form.pincode}
              onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))}
              placeholder="Pincode"
            />
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Address</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary min-h-[80px]"
                placeholder="Address"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-text-secondary">{t('schemes.documents_required')}</p>
            <ul className="list-disc list-inside text-text-secondary text-sm">
              {documentsRequired.length === 0 ? (
                <li>{t('documents.aadhaar')}, {t('documents.bank_passbook')} ({t('form.upload_missing')})</li>
              ) : (
                documentsRequired.map((d) => (
                  <li key={d}>{d.replace(/_/g, ' ')}</li>
                ))
              )}
            </ul>
            <p className="text-sm text-text-muted">{t('form.upload_missing')}</p>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-display font-semibold text-text-primary">{t('form.step3')}</h3>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <dt className="text-text-muted">Name</dt><dd className="text-text-primary">{form.fullName}</dd>
              <dt className="text-text-muted">Phone</dt><dd className="text-text-primary">{form.phone}</dd>
              <dt className="text-text-muted">State / District</dt><dd className="text-text-primary">{form.state}, {form.district}</dd>
              <dt className="text-text-muted">Pincode</dt><dd className="text-text-primary">{form.pincode}</dd>
              <dt className="text-text-muted">Scheme</dt><dd className="text-text-primary">{schemeName}</dd>
            </dl>
            <label className="flex items-start gap-2 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={declarationAccepted}
                onChange={(e) => setDeclarationAccepted(e.target.checked)}
                className="mt-1 rounded border-surface-border"
              />
              <span className="text-sm text-text-secondary">{t('form.declaration')}</span>
            </label>
          </div>
        )}

        {error && <p className="text-red-700 text-sm mt-2">{error}</p>}

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            {t('form.previous')}
          </Button>
          {step < 3 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={(step === 1 && !canProceedStep2) || (step === 2 && !canProceedStep3)}>
              {t('form.next')}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canSubmitStep4 || submitting}>
              {submitting ? t('common.loading') : t('form.submit')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
