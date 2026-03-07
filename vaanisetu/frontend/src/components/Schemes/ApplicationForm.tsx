import { useEffect, useMemo, useState } from 'react';
import {
  createApplication,
  fetchDocuments,
  fetchProfile,
  getDocumentStatus,
  requestDocumentUpload,
  resolveDocumentReplacement,
  type DocumentRecord,
} from '../../services/api';
import Button from '../Common/Button';
import Input from '../Common/Input';
import { getApiUserId, useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

interface ApplicationFormProps {
  schemeId: string;
  schemeName: string;
  documentsRequired: string[];
  onClose: () => void;
  onSuccess: (applicationId: string) => void;
}

type UploadableDocType = 'aadhaar' | 'pan' | 'bank_passbook' | 'income_certificate';

const SUPPORTED_UPLOAD_DOCS: Record<string, UploadableDocType> = {
  aadhaar: 'aadhaar',
  aadhar: 'aadhaar',
  pan: 'pan',
  bank_account: 'bank_passbook',
  bank_passbook: 'bank_passbook',
  bank_pass_book: 'bank_passbook',
  passbook: 'bank_passbook',
  income: 'income_certificate',
  income_certificate: 'income_certificate',
};

function normalizeDocType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function canonicalDocType(value: string): string {
  const normalized = normalizeDocType(value)
    .replace(/_card$/g, '')
    .replace(/_certificate$/g, '')
    .replace(/_proof$/g, '');
  return SUPPORTED_UPLOAD_DOCS[normalized] ?? normalized;
}

function isSuccessfulStatus(status?: string): boolean {
  return ['processed', 'verified', 'approved', 'completed'].includes(String(status ?? '').toLowerCase());
}

function getCurrentDocumentByType(items: DocumentRecord[], type: string): DocumentRecord | undefined {
  const docs = items
    .filter((item) => canonicalDocType(String(item.document_type || item.documentType || '')) === canonicalDocType(type))
    .sort((a, b) => {
      const aTime = Date.parse(String(a.processed_at || a.processedAt || a.uploaded_at || a.uploadedAt || '')) || 0;
      const bTime = Date.parse(String(b.processed_at || b.processedAt || b.uploaded_at || b.uploadedAt || '')) || 0;
      return bTime - aTime;
    });

  const hasExplicitCurrent = docs.some((item) => typeof item.is_current === 'boolean' || typeof item.isCurrent === 'boolean');
  if (hasExplicitCurrent) {
    return docs.find((item) => (item.is_current ?? item.isCurrent) === true && isSuccessfulStatus(item.status));
  }
  return docs.find((item) => isSuccessfulStatus(item.status));
}

function getLatestAttemptByType(items: DocumentRecord[], type: string): DocumentRecord | undefined {
  return items
    .filter((item) => canonicalDocType(String(item.document_type || item.documentType || '')) === canonicalDocType(type))
    .sort((a, b) => {
      const aTime = Date.parse(String(a.processed_at || a.processedAt || a.uploaded_at || a.uploadedAt || '')) || 0;
      const bTime = Date.parse(String(b.processed_at || b.processedAt || b.uploaded_at || b.uploadedAt || '')) || 0;
      return bTime - aTime;
    })[0];
}

export default function ApplicationForm({ schemeId, schemeName, documentsRequired, onClose, onSuccess }: ApplicationFormProps) {
  const { user } = useAuth();
  const userId = getApiUserId() || user?.id || null;
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState<Record<string, unknown>>({});
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [refreshingDocuments, setRefreshingDocuments] = useState(false);
  const [uploadingDocType, setUploadingDocType] = useState<string | null>(null);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdApplicationId, setCreatedApplicationId] = useState<string | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<string>('submitted');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    state: '',
    district: '',
    pincode: '',
    address: '',
  });

  const refreshDocuments = async () => {
    if (!userId) return;
    setRefreshingDocuments(true);
    try {
      const res = await fetchDocuments(userId);
      setDocuments(res.data?.documents ?? []);
    } finally {
      setRefreshingDocuments(false);
    }
  };

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
      .catch(() => {})
      .finally(() => setLoadingProfile(false));

    void refreshDocuments();
  }, [userId]);

  const uploadableRequirements = useMemo(() => documentsRequired
    .map((doc) => ({ raw: doc, uploadType: SUPPORTED_UPLOAD_DOCS[normalizeDocType(doc)] }))
    .filter((doc): doc is { raw: string; uploadType: UploadableDocType } => !!doc.uploadType), [documentsRequired]);

  const manualRequirements = useMemo(() => documentsRequired
    .filter((doc) => !SUPPORTED_UPLOAD_DOCS[normalizeDocType(doc)]), [documentsRequired]);

  const uploadableRequirementStates = useMemo(() => uploadableRequirements.map((requirement) => {
    const current = getCurrentDocumentByType(documents, requirement.uploadType);
    const latest = getLatestAttemptByType(documents, requirement.uploadType);
    const hasPendingFailedReplacement = latest
      && latest.status === 'failed'
      && current
      && String(latest.replacement_decision || latest.replacementDecision || 'pending') === 'pending'
      && String(latest.replaces_document_id || latest.replacesDocumentId || '') !== '';
    return {
      ...requirement,
      current,
      latest,
      ready: !!current && isSuccessfulStatus(current.status),
      hasPendingFailedReplacement,
    };
  }), [documents, uploadableRequirements]);

  const uploadableMissingDocuments = uploadableRequirementStates
    .filter((item) => !item.ready)
    .map((item) => item.raw);

  const canProceedStep2 = form.fullName.trim() && form.state.trim() && form.district.trim();
  const canProceedStep3 = uploadableMissingDocuments.length === 0;
  const canSubmitStep4 = declarationAccepted && uploadableMissingDocuments.length === 0;

  const handleUpload = async (documentType: UploadableDocType, file: File) => {
    if (!userId) {
      setError(t('auth.login_required'));
      return;
    }

    setUploadingDocType(documentType);
    setError(null);

    try {
      const res = await requestDocumentUpload({
        userId,
        documentType,
        fileName: file.name,
        contentType: file.type,
      });
      const payload = (res as any)?.data;
      const uploadUrl = payload?.uploadUrl;
      const documentId = payload?.documentId;
      if (!uploadUrl || !documentId) throw new Error('Upload failed to initialize');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'))));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      const pollStart = Date.now();
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        const statusRes = await getDocumentStatus(documentId, userId ?? undefined);
        const status = statusRes.data?.status;
        if (status === 'processed' || status === 'failed') break;
        if (Date.now() - pollStart > 90000) throw new Error('Document processing timed out');
      }

      await refreshDocuments();
    } catch (uploadError: any) {
      setError(uploadError?.message || t('documents.upload_error'));
    } finally {
      setUploadingDocType(null);
    }
  };

  const handleReplacementDecision = async (documentId: string, keepPrevious: boolean) => {
    try {
      await resolveDocumentReplacement(documentId, keepPrevious);
      if (keepPrevious) {
        setError('The new document could not be processed. Keeping the previous verified document.');
      } else {
        setError('The failed upload was kept out. This document slot is now marked as not uploaded.');
      }
      await refreshDocuments();
    } catch {
      setError(t('common.error'));
    }
  };

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
        formData: { ...profile, ...form },
      });

      const payload = res?.data ?? {};
      if (!payload.applicationId) {
        setError(payload.message || 'Could not submit application.');
        return;
      }

      setCreatedApplicationId(payload.applicationId);
      setSubmissionStatus(payload.status || 'submitted');
    } catch {
      setError(t('common.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (createdApplicationId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div className="bg-surface-card rounded-card shadow-card max-w-md w-full p-6 relative overflow-hidden">
          <h2 className="font-display text-2xl font-bold text-text-primary text-center">{t('form.congratulations')}</h2>
          <p className="text-text-secondary text-center mt-2">
            {submissionStatus === 'pending_documents'
              ? 'Application created. A few additional non-uploadable documents are still needed at the next stage.'
              : t('form.expected_decision')}
          </p>
          <div className="mt-6 p-4 bg-primary-50 rounded-lg border border-primary-200">
            <p className="text-sm text-text-secondary mb-1">{t('form.ref_number')}</p>
            <p className="font-mono text-lg font-bold text-primary-700 break-all">{createdApplicationId}</p>
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Button onClick={() => onSuccess(createdApplicationId)}>{t('form.track')}</Button>
            <Button variant="outline" onClick={onClose}>{t('form.close')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="bg-surface-card rounded-card shadow-card max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-xl font-semibold text-text-primary">{t('schemes.apply_now')} - {schemeName}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        <div className="flex gap-2 mb-6">
          {[1, 2, 3].map((value) => (
            <div key={value} className={`h-1 flex-1 rounded-full ${step >= value ? 'bg-primary-500' : 'bg-surface-border'}`} />
          ))}
        </div>

        {step === 1 ? (
          <div className="space-y-4">
            {loadingProfile ? <p className="text-text-muted text-sm">{t('common.loading')}</p> : <p className="text-sm text-text-secondary">{t('form.prefilled')}</p>}
            <Input label={t('profile.full_name')} value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} />
            <Input label={t('profile.phone_readonly')} value={form.phone} readOnly />
            <Input label={t('eligibility.state')} value={form.state} onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))} />
            <Input label={t('eligibility.district')} value={form.district} onChange={(e) => setForm((prev) => ({ ...prev, district: e.target.value }))} />
            <Input label="Pincode" value={form.pincode} onChange={(e) => setForm((prev) => ({ ...prev, pincode: e.target.value }))} />
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Address</label>
              <textarea
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                className="w-full rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary min-h-[80px]"
              />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-text-secondary">{t('schemes.documents_required')}</p>
              {refreshingDocuments ? <span className="text-xs text-text-muted">Refreshing document status...</span> : null}
            </div>

            {uploadableRequirementStates.length > 0 ? (
              <div className="space-y-3">
                {uploadableRequirementStates.map((item) => {
                  const currentStatus = item.current?.status;
                  const latestStatus = item.latest?.status;
                  const latestId = String(item.latest?.document_id || item.latest?.documentId || '');
                  return (
                    <div key={item.raw} className="rounded-xl border border-surface-border bg-surface-elevated p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-text-primary capitalize">{item.raw.replace(/_/g, ' ')}</div>
                          <div className="text-xs text-text-muted mt-1">
                            {item.ready
                              ? `Verified and ready to use (${currentStatus}).`
                              : latestStatus === 'processing'
                                ? 'Currently processing the latest upload.'
                                : 'This document still needs a verified upload.'}
                          </div>
                        </div>

                        <label className="inline-flex">
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.pdf"
                            className="hidden"
                            disabled={uploadingDocType === item.uploadType}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void handleUpload(item.uploadType, file);
                              event.target.value = '';
                            }}
                          />
                          <span className="inline-flex cursor-pointer rounded-lg border border-primary-300 px-3 py-1.5 text-sm font-medium text-primary-700 bg-primary-50">
                            {uploadingDocType === item.uploadType ? 'Uploading...' : item.ready ? 'Replace document' : 'Upload document'}
                          </span>
                        </label>
                      </div>

                      {item.hasPendingFailedReplacement && latestId ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <p>The new upload failed to process. Keep the old verified document?</p>
                          <div className="flex gap-2 mt-3">
                            <Button size="sm" onClick={() => void handleReplacementDecision(latestId, true)}>Yes, keep old</Button>
                            <Button size="sm" variant="outline" onClick={() => void handleReplacementDecision(latestId, false)}>No, clear it</Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No inline-uploadable documents are required for this scheme.</p>
            )}

            {manualRequirements.length > 0 ? (
              <div className="rounded-xl border border-surface-border bg-surface-bg p-4">
                <div className="font-semibold text-text-primary mb-2">Additional documents for later stage</div>
                <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
                  {manualRequirements.map((doc) => (
                    <li key={doc}>{doc.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <h3 className="font-display font-semibold text-text-primary">{t('form.step3')}</h3>
            <dl className="grid grid-cols-1 gap-2 text-sm">
              <dt className="text-text-muted">Name</dt><dd className="text-text-primary">{form.fullName}</dd>
              <dt className="text-text-muted">Phone</dt><dd className="text-text-primary">{form.phone}</dd>
              <dt className="text-text-muted">State / District</dt><dd className="text-text-primary">{form.state}, {form.district}</dd>
              <dt className="text-text-muted">Pincode</dt><dd className="text-text-primary">{form.pincode || '-'}</dd>
              <dt className="text-text-muted">Scheme</dt><dd className="text-text-primary">{schemeName}</dd>
              <dt className="text-text-muted">Inline documents ready</dt>
              <dd className="text-text-primary">{uploadableRequirementStates.filter((item) => item.ready).length} / {uploadableRequirementStates.length}</dd>
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
        ) : null}

        {error ? <p className="text-red-700 text-sm mt-4">{error}</p> : null}

        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1}>
            {t('form.previous')}
          </Button>
          {step < 3 ? (
            <Button
              onClick={() => setStep((value) => value + 1)}
              disabled={(step === 1 && !canProceedStep2) || (step === 2 && !canProceedStep3)}
            >
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
