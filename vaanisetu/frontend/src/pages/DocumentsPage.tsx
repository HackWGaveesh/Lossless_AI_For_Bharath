import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Common/Button';
import { fetchDocuments, requestDocumentUpload, getDocumentStatus } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

type DocType = 'aadhaar' | 'pan' | 'bank_passbook' | 'income_certificate';

interface DocItem {
  type: DocType;
  label: string;
  documentId?: string;
  status?: string;
  structured_data?: Record<string, unknown>;
  error_message?: string;
  uploadedAt?: string;
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

function getDocTimestamp(doc: any): number {
  const processed = Date.parse(String(doc?.processed_at || doc?.processedAt || ''));
  const uploaded = Date.parse(String(doc?.uploaded_at || doc?.uploadedAt || ''));
  const p = Number.isNaN(processed) ? 0 : processed;
  const u = Number.isNaN(uploaded) ? 0 : uploaded;
  return Math.max(p, u);
}
/** Recursively flatten nested objects into displayable [label, value] pairs */
function flattenObject(obj: Record<string, unknown>, prefix = ''): [string, string][] {
  const entries: [string, string][] = [];

  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const displayKey = prefix
      ? `${prefix} > ${rawKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`
      : rawKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    if (rawValue === null || rawValue === undefined) {
      continue; // skip null/undefined
    } else if (Array.isArray(rawValue)) {
      // Render array items as comma-separated string
      const items = rawValue.map((item) =>
        typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item)
      );
      entries.push([displayKey, items.join(', ')]);
    } else if (typeof rawValue === 'object') {
      // Recurse into nested objects
      const nested = flattenObject(rawValue as Record<string, unknown>, displayKey);
      entries.push(...nested);
    } else {
      entries.push([displayKey, String(rawValue)]);
    }
  }

  return entries;
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

  const userId = user?.id ?? 'demo-user-1';

  useEffect(() => {
    mountedRef.current = true;

    // Fetch existing documents on mount for persistence
    const loadDocs = async () => {
      try {
        const res = await fetchDocuments(userId);
        if (res.success && res.data?.documents && mountedRef.current) {
          const fetchedDocs = res.data.documents;
          const latestByType = new Map<string, any>();
          for (const fd of fetchedDocs) {
            const key = String(fd.document_type || fd.documentType || 'unknown');
            const prev = latestByType.get(key);
            if (!prev || getDocTimestamp(fd) >= getDocTimestamp(prev)) {
              latestByType.set(key, fd);
            }
          }
          setDocs((prev) => prev.map((d) => {
            const found = latestByType.get(d.type);
            if (found) {
              return {
                ...d,
                documentId: found.document_id || found.documentId,
                status: found.status,
                structured_data: found.structured_data,
                uploadedAt: found.uploaded_at || found.uploadedAt
              };
            }
            return d;
          }));
        }
      } catch (err) {
        console.error('Failed to load documents', err);
      }
    };

    loadDocs();

    return () => { mountedRef.current = false; };
  }, [userId]);

  const POLL_INTERVAL_MS = 4000;
  const MAX_POLL_MS = 90000;
  const SLOW_HINT_MS = 5000;

  const checkDocumentStatus = async (documentId: string, documentType: DocType) => {
    try {
      const res = await getDocumentStatus(documentId);
      const status = res.data?.status ?? 'processing';
      const structured_data = res.data?.structured_data;
      const error_message = res.data?.error_message as string | undefined;
      if (mountedRef.current) {
        setDocs((prev) => prev.map((d) => (d.type === documentType ? { ...d, status, structured_data, error_message } : d)));
        if (status === 'processed' || status === 'failed') {
          setProcessingId(null);
          setProcessingDocId(null);
          setProcessingDocType(null);
          setProcessingTimeout(false);
          setProcessingSlowHint(false);
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
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable && mountedRef.current) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'))));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      if (!mountedRef.current) return;
      setDocs((prev) => prev.map((d) => (d.type === documentType ? { ...d, documentId, status: 'processing', uploadedAt: new Date().toISOString() } : d)));
      setProcessingId(documentId);
      setProcessingDocId(documentId);
      setProcessingDocType(documentType);
      setUploadProgress(100);

      const slowHintTimer = setTimeout(() => { if (mountedRef.current) setProcessingSlowHint(true); }, SLOW_HINT_MS);
      const pollStart = Date.now();
      const poll = async () => {
        for (; ;) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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
          setProcessingDocId(null);
          setProcessingDocType(null);
        }
      };
      poll();
    } catch (e) {
      console.error(e);
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        setUploadProgress(0);
      }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && /\.(jpg|jpeg|png|pdf)$/i.test(file.name)) uploadFile(file);
  };

  const onSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const docTypes: DocType[] = ['aadhaar', 'pan', 'bank_passbook', 'income_certificate'];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-semibold text-text-primary">{t('documents.title')}</h1>

      <div
        className={`border-2 border-dashed rounded-card p-12 text-center transition-colors ${dragOver ? 'border-primary-500 bg-primary-50' : 'border-surface-border bg-surface-elevated'
          }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className="text-text-secondary mb-2">{'\u{1F4E4}'} {t('documents.drag_drop')}</p>
        <p className="text-sm text-text-muted mb-4">{t('documents.supported')}</p>
        <div className="flex flex-wrap gap-2 justify-center mb-4">
          {docTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(type)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${selectedType === type ? 'bg-primary-500 text-white' : 'bg-surface-card border border-surface-border text-text-secondary hover:border-primary-300'
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
        {uploading && (
          <div className="mt-4 w-full max-w-xs mx-auto h-2 bg-surface-border rounded-full overflow-hidden">
            <div className="h-full bg-primary-500 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {processingId && (
          <p className="mt-4 text-sm text-primary-500">{t('documents.processing')}</p>
        )}
        {processingSlowHint && processingId && (
          <p className="mt-2 text-xs text-text-muted">{t('documents.processing_long')}</p>
        )}
        {processingTimeout && processingDocId && processingDocType && (
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
        )}
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {docs.map((doc) => {
          return (
            <div
              key={doc.type}
              className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-4xl">{DOC_ICONS[doc.type]}</div>
                {doc.status === 'processed' && (
                  <span className="bg-accent-50 text-accent-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-accent-200 uppercase tracking-wider">
                    VERIFIED {'\u2713'}
                  </span>
                )}
              </div>
              <h3 className="font-semibold text-text-primary text-lg">{t(DOC_TYPE_KEYS[doc.type])}</h3>

              <div className="mt-2 min-h-[1.5rem]">
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

              {doc.status === 'failed' && doc.error_message && (
                <p className="text-xs text-red-700 mt-2 bg-red-50 p-2 rounded-lg border border-red-100">{doc.error_message}</p>
              )}

              {doc.structured_data && typeof doc.structured_data === 'object' && Object.keys(doc.structured_data).length > 0 && (
                <div className="mt-4 p-4 bg-surface-elevated rounded-xl border border-accent-100 space-y-2 shadow-inner">
                <div className="flex items-center justify-between pb-1 border-b border-accent-50 mb-1">
                  <p className="text-accent-700 text-[10px] font-bold uppercase tracking-tight">AI Extracted Details</p>
                  <span className="text-[10px] text-text-muted italic">Verified {'\u26A1'}</span>
                </div>

                  <div className="grid gap-y-1.5">
                    {flattenObject(doc.structured_data).map(([k, v]) => (
                      <div key={k} className="flex flex-col">
                        <span className="text-[10px] text-text-muted font-semibold uppercase">{k}</span>
                        <span className="text-text-primary text-sm font-medium break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

