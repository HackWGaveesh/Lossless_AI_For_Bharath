import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from 'react-query';
import Button from '../Common/Button';
import { useLanguage } from '../../contexts/LanguageContext';
import { createApplication, fetchProfile, type Job } from '../../services/api';
import { getApiUserId } from '../../contexts/AuthContext';

const JOBS_REQUIRED_FIELDS = ['state', 'occupation'] as const;

export type JobApplyModalStep = 'checking' | 'profile_gaps' | 'confirm';

interface JobApplyModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function JobApplyModal({ job, isOpen, onClose, onSuccess }: JobApplyModalProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = getApiUserId();
  const [step, setStep] = useState<JobApplyModalStep>('checking');
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkProfileAndOpen = async () => {
    setError(null);
    try {
      const res = await fetchProfile();
      const profile = (res?.data?.profile ?? {}) as Record<string, unknown>;
      const missing = JOBS_REQUIRED_FIELDS.filter((f) => {
        const val = profile[f] ?? profile[f === 'state' ? 'State' : 'Occupation'];
        return val == null || String(val).trim() === '';
      });
      if (missing.length > 0) {
        setMissingFields(missing);
        setStep('profile_gaps');
      } else {
        setStep('confirm');
      }
    } catch {
      setError(t('common.error'));
      setStep('confirm');
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStep('checking');
      setMissingFields([]);
      setError(null);
      void checkProfileAndOpen();
    }
  }, [isOpen, job.jobId]);

  const handleFillProfile = () => {
    onClose();
    navigate('/profile');
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await createApplication({
        userId: userId || 'demo-user-1',
        jobId: job.jobId,
        jobTitle: job.title,
        company: job.company,
        idempotencyKey: `job-${job.jobId ?? job.title}-${Date.now()}`,
      });
      const data = res.data as { applicationId?: string; alreadyApplied?: boolean; message?: string };
      if (data.alreadyApplied) {
        queryClient.invalidateQueries('applications');
        queryClient.invalidateQueries('userStats');
        onClose();
        onSuccess?.();
        return;
      }
      const applicationId = data.applicationId;
      if (!applicationId) {
        setError(data.message || 'Could not create job application.');
        return;
      }
      queryClient.invalidateQueries('applications');
      queryClient.invalidateQueries('userStats');
      onClose();
      onSuccess?.();
      navigate(`/applications?id=${applicationId}`);
    } catch (err: unknown) {
      const res = (err as { response?: { data?: { error?: { message?: string }; message?: string } } })?.response?.data;
      const msg = res?.error?.message ?? res?.message;
      setError(msg || 'Could not create job application.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-surface-card rounded-xl shadow-card border border-surface-border max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'checking' && (
          <div className="py-4 text-center text-text-secondary">
            {t('common.loading')}
          </div>
        )}
        {step === 'profile_gaps' && (
          <>
            <h3 className="font-display text-lg font-semibold text-text-primary mb-2">
              {t('jobs.profile_incomplete')}
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              {t('jobs.profile_missing')} {missingFields.map((f) => f).join(', ')}
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleFillProfile}>{t('jobs.fill_profile')}</Button>
            </div>
          </>
        )}
        {step === 'confirm' && (
          <>
            <h3 className="font-display text-lg font-semibold text-text-primary mb-2">
              {t('jobs.confirm_application')}
            </h3>
            <p className="text-text-secondary text-sm mb-4">
              {t('jobs.confirm_application_text')
                .replace('{title}', job.title ?? '')
                .replace('{company}', job.company ?? '')}
            </p>
            {error && <p className="text-sm text-red-700 mb-4">{error}</p>}
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleConfirm()} disabled={submitting}>
                {submitting ? t('common.loading') : t('jobs.confirm')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { JOBS_REQUIRED_FIELDS };
