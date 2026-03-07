import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getApiUserId } from '../contexts/AuthContext';
import Button from '../components/Common/Button';
import DocumentProcessingTimeline from '../components/Documents/DocumentProcessingTimeline';
import { fetchDocuments, requestDocumentUpload, getDocumentStatus, resolveDocumentReplacement } from '../services/api';
import type { DocumentProcessingStep, DocumentRecord } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

type DocType = 'aadhaar' | 'pan' | 'bank_passbook' | 'income_certificate';

interface DocItem {
  type: DocType;
  label: string;
  documentId?: string;
  status?: string;
  currentStage?: string;
  processingSteps?: DocumentProcessingStep[];
  structuredData?: Record<string, unknown>;
  errorMessage?: string;
  uploadedAt?: string;
  processedAt?: string;
  replacementPendingDocumentId?: string;
  hasPendingFailedReplacement?: boolean;
}

const DOC_TYPE_KEYS: Record<DocType, string> = {
  aadhaar: 'documents.aadhaar',
  pan: 'documents.pan',
  bank_passbook: 'documents.bank_passbook',
  income_certificate: 'documents.income_certificate',
};

const DOC_ICONS: Record<DocType, string> = {
  aadhaar: '\u{1F194}',
  pan: '\u{1F4B3}',
  bank_passbook: '\u{1F3E6}',
  income_certificate: '\u{1F4C4}',
};

function getDocTimestamp(doc: DocumentRecord | DocItem): number {
  const processed = Date.parse(String((doc as DocumentRecord).processed_at || (doc as DocItem).processedAt || ''));
  const uploaded = Date.parse(String((doc as DocumentRecord).uploaded_at || (doc as DocItem).uploadedAt || ''));
  const p = Number.isNaN(processed) ? 0 : processed;
  const u = Number.isNaN(uploaded) ? 0 : uploaded;
  return Math.max(p, u);
}

function normalizeDocType(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function getCurrentDocumentByType(items: DocumentRecord[], type: DocType): DocumentRecord | undefined {
  const docs = items
    .filter((item) => normalizeDocType(String(item.document_type || item.documentType || '')) === type)
    .sort((a, b) => getDocTimestamp(b) - getDocTimestamp(a));
  const hasExplicitCurrent = docs.some((item) => typeof item.is_current === 'boolean' || typeof item.isCurrent === 'boolean');
  if (hasExplicitCurrent) {
    return docs.find((item) => (item.is_current ?? item.isCurrent) === true && isSuccessfulStatus(item.status));
  }
  return docs.find((item) => isSuccessfulStatus(item.status));
}

function getLatestAttemptByType(items: DocumentRecord[], type: DocType): DocumentRecord | undefined {
  return items
    .filter((item) => normalizeDocType(String(item.document_type || item.documentType || '')) === type)
    .sort((a, b) => getDocTimestamp(b) - getDocTimestamp(a))[0];
}

function isSuccessfulStatus(status?: string): boolean {
  return ['processed', 'verified', 'approved', 'completed'].includes(String(status ?? '').toLowerCase());
}

function flattenObject(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const entries: [string, string][] = [];

  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const displayKey = prefix
      ? `${prefix} > ${rawKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
      : rawKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      entries.push([displayKey, rawValue.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')]);
      continue;
    }
    if (typeof rawValue === 'object') {
      entries.push(...flattenObject(rawValue as Record<string, unknown>, displayKey));
      continue;
    }
    entries.push([displayKey, String(rawValue)]);
  }

  return entries;
}

const EXTRACTED_DETAILS_KEYS: Record<DocType, string[]> = {
  aadhaar: ['Full Name', 'Father/Husband Name', 'Gender', 'Date Of Birth', 'Address', 'ID Number', 'Aadhaar Number'],
  pan: ['Full Name', 'PAN Number', "Father's Name", "Father's name", 'Date Of Birth'],
  bank_passbook: ['Account Holder Name', 'Account Number', 'Bank Name', 'Branch', 'IFSC Code', 'Account Type'],
  income_certificate: ['Applicant Name', 'Annual Income', 'Issuing Authority', 'Certificate Number', 'Date Of Issue', 'Valid Until'],
};

const TECHNICAL_KEYS = new Set([
  'documenttype', 'mimetype', 'inputmode', 'extractionmethod', 'fieldcount', 'extractedfields',
  'verifiedfields', 'pagesanalyzed', 'current_stage', 'pages', 'upload',
]);

function getDisplayExtractedEntries(docType: DocType, structuredData: Record<string, unknown>): [string, string][] {
  const flat = flattenObject(structuredData);
  const allowed = EXTRACTED_DETAILS_KEYS[docType];
  const allowedNorm = new Set(allowed.map((k) => k.replace(/\s+/g, ' ').trim().toLowerCase()));
  const filtered = flat.filter(([key, value]) => {
    const norm = key.replace(/\s+/g, ' ').trim().toLowerCase();
    const allowedKey = allowedNorm.has(norm);
    const hasValue = value != null && String(value).trim() !== '';
    return allowedKey && hasValue;
  });
  if (filtered.length > 0) return filtered;
  const fallback = flat.filter(([key, value]) => {
    const norm = key.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s+/g, '');
    const isTechnical = TECHNICAL_KEYS.has(norm);
    const hasValue = value != null && String(value).trim() !== '';
    return !isTechnical && hasValue;
  });
  return fallback;
}

function normalizeDocItem(type: DocType, records: DocumentRecord[]): DocItem {
  const current = getCurrentDocumentByType(records, type);
  const latest = getLatestAttemptByType(records, type);
  const discardedFailedAttempt = !current
    && latest?.status === 'failed'
    && String(latest.replacement_decision || latest.replacementDecision || '') === 'discard_previous';
  const base = discardedFailedAttempt ? undefined : (current ?? latest);
  const hasPendingFailedReplacement = !!latest
    && latest.status === 'failed'
    && !!current
    && String(latest.replacement_decision || latest.replacementDecision || 'pending') === 'pending'
    && String(latest.replaces_document_id || latest.replacesDocumentId || '') !== '';

  return {
    type,
    label: '',
    documentId: (base?.document_id || base?.documentId) ?? '',
    status: base?.status,
    currentStage: base?.current_stage || base?.currentStage,
    processingSteps: base?.processing_steps || base?.processingSteps,
    structuredData: base?.structured_data || base?.structuredData,
    errorMessage: discardedFailedAttempt ? undefined : (hasPendingFailedReplacement && latest?.status === 'failed' ? (latest.error_message || latest.errorMessage) : (base?.error_message || base?.errorMessage)),
    uploadedAt: base?.uploaded_at || base?.uploadedAt,
    processedAt: base?.processed_at || base?.processedAt,
    replacementPendingDocumentId: hasPendingFailedReplacement ? String(latest?.document_id || latest?.documentId || '') : undefined,
    hasPendingFailedReplacement,
  };
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocItem[]>(['aadhaar', 'pan', 'bank_passbook', 'income_certificate'].map((type) => ({
    type: type as DocType,
    label: '',
  })));
  const [selectedType, setSelectedType] = useState<DocType>('aadhaar');
  const [processingSlowHint, setProcessingSlowHint] = useState(false);
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [processingDocType, setProcessingDocType] = useState<DocType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const completedDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const userId = getApiUserId() || user?.id || 'demo-user-1';

  const clearProcessingState = () => {
    setProcessingId(null);
    setProcessingDocId(null);
    setProcessingDocType(null);
    setProcessingTimeout(false);
    setProcessingSlowHint(false);
  };

  useEffect(() => {
    mountedRef.current = true;

    const loadDocs = async () => {
      try {
        const res = await fetchDocuments(userId);
        if (res.success && res.data?.documents && mountedRef.current) {
          const allDocs = res.data.documents;
          setDocs((prev) => prev.map((doc) => normalizeDocItem(doc.type, allDocs)));
        }
      } catch (err) {
        console.error('Failed to load documents', err);
      }
    };

    loadDocs();

    return () => {
      mountedRef.current = false;
      if (completedDismissTimerRef.current) {
        clearTimeout(completedDismissTimerRef.current);
        completedDismissTimerRef.current = null;
      }
    };
  }, [userId]);

  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_MS = 120000;
  const SLOW_HINT_MS = 8000;

  const checkDocumentStatus = async (documentId: string, documentType: DocType) => {
    try {
      const res = await getDocumentStatus(documentId, userId);
      const payload = res.data;
      const status = payload?.status ?? 'processing';
      if (mountedRef.current) {
        setDocs((prev) => prev.map((doc) => (
          doc.type === documentType
            ? {
              ...doc,
              documentId,
              status,
              currentStage: payload?.current_stage,
              processingSteps: payload?.processing_steps ?? doc.processingSteps,
              structuredData: payload?.structured_data,
              processedAt: payload?.processed_at,
              errorMessage: payload?.error_message,
            }
            : doc
        )));
        await (async () => {
          const refreshed = await fetchDocuments(userId);
          const allDocs = refreshed.data?.documents ?? [];
          setDocs((prev) => prev.map((doc) => {
            if (doc.type === documentType && doc.documentId === documentId) return doc;
            return normalizeDocItem(doc.type, allDocs);
          }));
        })();

        if (status === 'processed' || status === 'failed') {
          if (completedDismissTimerRef.current) clearTimeout(completedDismissTimerRef.current);
          completedDismissTimerRef.current = setTimeout(() => {
            completedDismissTimerRef.current = null;
            if (mountedRef.current) clearProcessingState();
          }, 10000);
        }
      }
      return status === 'processed' || status === 'failed';
    } catch {
      return false;
    }
  };

  const uploadFile = async (file: File) => {
    const documentType = selectedType;
    if (mountedRef.current) {
      if (completedDismissTimerRef.current) {
        clearTimeout(completedDismissTimerRef.current);
        completedDismissTimerRef.current = null;
      }
      setUploading(true);
      setUploadProgress(0);
      setProcessingSlowHint(false);
      setProcessingTimeout(false);
    }

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
      if (!uploadUrl || !documentId) throw new Error('Upload failed');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && mountedRef.current) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });
        xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'))));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      if (!mountedRef.current) return;

      setDocs((prev) => prev.map((doc) => (
        doc.type === documentType
          ? {
            ...doc,
            documentId,
            status: 'processing',
            currentStage: 'upload',
            uploadedAt: new Date().toISOString(),
            processingSteps: [
              {
                id: 'upload',
                label: 'Upload received',
                status: 'in_progress',
                detail: 'File uploaded and queued for document processing.',
              },
            ],
            structuredData: undefined,
            errorMessage: undefined,
          }
          : doc
      )));
      setProcessingId(documentId);
      setProcessingDocId(documentId);
      setProcessingDocType(documentType);
      setUploadProgress(100);

      const slowHintTimer = setTimeout(() => {
        if (mountedRef.current) setProcessingSlowHint(true);
      }, SLOW_HINT_MS);

      const pollStart = Date.now();
      let pollCount = 0;
      const poll = async () => {
        for (;;) {
          await new Promise((resolve) => setTimeout(resolve, pollCount === 0 ? 1500 : POLL_INTERVAL_MS));
          pollCount += 1;
          if (!mountedRef.current) break;
          if (Date.now() - pollStart >= MAX_POLL_MS) {
            setProcessingTimeout(true);
            setProcessingId(null);
            break;
          }
          const done = await checkDocumentStatus(documentId, documentType);
          if (done) break;
        }
        clearTimeout(slowHintTimer);
        if (mountedRef.current) {
          setProcessingSlowHint(false);
        }
      };
      poll();
    } catch (err) {
      console.error(err);
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file && /\.(jpg|jpeg|png|pdf)$/i.test(file.name)) uploadFile(file);
  };

  const onSelectFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) uploadFile(file);
    event.target.value = '';
  };

  const docTypes: DocType[] = ['aadhaar', 'pan', 'bank_passbook', 'income_certificate'];

  const liveDoc = useMemo(
    () => docs.find((doc) => doc.type === processingDocType && doc.documentId === processingDocId) ?? null,
    [docs, processingDocId, processingDocType],
  );

  const handleReplacementDecision = async (documentId: string, keepPrevious: boolean, docType?: DocType, openFilePicker?: boolean) => {
    await resolveDocumentReplacement(documentId, keepPrevious);
    const refreshed = await fetchDocuments(userId);
    const allDocs = refreshed.data?.documents ?? [];
    setDocs((prev) => prev.map((doc) => normalizeDocItem(doc.type, allDocs)));
    if (openFilePicker && docType != null) {
      setSelectedType(docType);
      setTimeout(() => inputRef.current?.click(), 100);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-text-primary">{t('documents.title')}</h1>

      <div
        className={`border-2 border-dashed rounded-card p-8 md:p-10 transition-colors ${
          dragOver ? 'border-primary-500 bg-primary-50' : 'border-surface-border bg-surface-elevated'
        }`}
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="text-center">
          <p className="text-text-secondary mb-2">{'\u{1F4E4}'} {t('documents.drag_drop')}</p>
          <p className="text-sm text-text-muted mb-4">{t('documents.supported')}</p>
          <div className="flex flex-wrap gap-2 justify-center mb-4">
            {docTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedType === type ? 'bg-primary-500 text-white' : 'bg-surface-card border border-surface-border text-text-secondary hover:border-primary-300'
                }`}
              >
                {t(DOC_TYPE_KEYS[type])}
              </button>
            ))}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf"
            className="hidden"
            onChange={onSelectFile}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? `${t('documents.uploading')} ${uploadProgress}%` : t('documents.choose_file')}
          </Button>
          {uploading ? (
            <div className="mt-4 w-full max-w-xs mx-auto h-2 bg-surface-border rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
            </div>
          ) : null}
          {processingId ? (
            <p className="mt-4 text-sm text-primary-500">{t('documents.processing')}</p>
          ) : null}
          {processingSlowHint && processingId ? (
            <p className="mt-2 text-xs text-text-muted">{t('documents.processing_long')}</p>
          ) : null}
          {processingTimeout && processingDocId && processingDocType ? (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <p className="text-amber-800">{t('documents.timeout')}</p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => checkDocumentStatus(processingDocId, processingDocType)}
              >
                {t('documents.check_status')}
              </Button>
            </div>
          ) : null}
        </div>

        {processingId && liveDoc ? (
          <div className="mt-6 rounded-3xl border border-primary-100 bg-white/80 p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl bg-primary-50 text-primary-600 flex items-center justify-center text-xl">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-text-primary">
                  {liveDoc.status === 'processed' ? 'Completed' : 'Live processing'}
                </div>
                <div className="text-xs text-text-muted">
                  {liveDoc.status === 'processed'
                    ? `${t(DOC_TYPE_KEYS[liveDoc.type])} verified. This view will close in 10 seconds.`
                    : `${t(DOC_TYPE_KEYS[liveDoc.type])} — steps update in real time. PDFs may take up to a minute.`}
                </div>
              </div>
            </div>
            <DocumentProcessingTimeline steps={liveDoc.processingSteps} />
          </div>
        ) : null}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
        {docs.map((doc) => (
          <div
            key={doc.type}
            className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <div className="text-4xl">{DOC_ICONS[doc.type]}</div>
              {doc.status === 'processed' ? (
                <span className="bg-accent-50 text-accent-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-accent-200 uppercase tracking-wider">
                  VERIFIED {'\u2713'}
                </span>
              ) : null}
            </div>
            <h3 className="font-semibold text-text-primary text-lg">{t(DOC_TYPE_KEYS[doc.type])}</h3>

            <div className="mt-3 min-h-[1.5rem]">
              {doc.status === 'processed' ? (
                <div className="flex items-center gap-1.5 text-accent-600 font-medium text-sm">
                  <div className="w-2 h-2 rounded-full bg-accent-500 animate-pulse" />
                  {t('documents.verified')}
                </div>
              ) : doc.status === 'processing' ? (
                <div className="flex items-center gap-1.5 text-primary-600 font-medium text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary-500 animate-bounce" />
                  {t('documents.processing')}
                </div>
              ) : doc.status === 'failed' ? (
                <div className="text-red-600 font-medium text-sm flex items-center gap-1.5">
                  <span className="text-lg">{'\u26A0'}</span>
                  Verification failed
                </div>
              ) : (
                <span className="text-text-muted text-sm italic">{t('documents.not_uploaded')}</span>
              )}
            </div>

            {doc.currentStage && doc.status === 'processing' ? (
              <p className="mt-2 text-xs text-text-muted">Current stage: {doc.currentStage.replace(/_/g, ' ')}</p>
            ) : null}

            {doc.errorMessage ? (
              <p className="text-xs text-red-700 mt-3 bg-red-50 p-2 rounded-lg border border-red-100">{doc.errorMessage}</p>
            ) : null}

            {doc.hasPendingFailedReplacement && doc.replacementPendingDocumentId ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium text-amber-900">New upload could not be verified. What would you like to do?</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <Button size="sm" onClick={() => void handleReplacementDecision(doc.replacementPendingDocumentId!, true, undefined, false)}>
                    Keep old verified document
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleReplacementDecision(doc.replacementPendingDocumentId!, false, undefined, false)}>
                    Leave this field blank
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleReplacementDecision(doc.replacementPendingDocumentId!, true, doc.type, true)}>
                    Re-upload (try another file)
                  </Button>
                </div>
              </div>
            ) : null}

            {doc.processingSteps?.length && doc.status === 'processing' ? (
              <DocumentProcessingTimeline steps={doc.processingSteps} compact />
            ) : null}

            {(() => {
              const entries = doc.structuredData && Object.keys(doc.structuredData).length > 0
                ? getDisplayExtractedEntries(doc.type, doc.structuredData)
                : [];
              return entries.length > 0 ? (
                <div className="mt-4 p-4 bg-surface-elevated rounded-xl border border-accent-100 space-y-2 shadow-inner">
                  <div className="flex items-center justify-between pb-1 border-b border-accent-50 mb-1">
                    <p className="text-accent-700 text-[10px] font-bold uppercase tracking-tight">AI Extracted Details</p>
                    <span className="text-[10px] text-text-muted italic">Verified {'\u26A1'}</span>
                  </div>
                  <div className="grid gap-y-1.5">
                    {entries.map(([key, value]) => (
                      <div key={key} className="flex flex-col">
                        <span className="text-[10px] text-text-muted font-semibold uppercase">{key}</span>
                        <span className="text-text-primary text-sm font-medium break-all">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
