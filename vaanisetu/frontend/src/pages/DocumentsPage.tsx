import { useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Common/Button';
import { requestDocumentUpload, getDocumentStatus } from '../services/api';
import { useLanguage } from '../contexts/LanguageContext';

type DocType = 'aadhaar' | 'pan' | 'bank_passbook' | 'income_certificate';

interface DocItem {
  type: DocType;
  label: string;
  icon: string;
  documentId?: string;
  status?: string;
  structured_data?: Record<string, unknown>;
  uploadedAt?: string;
}

const DOC_TYPE_KEYS: Record<DocType, string> = {
  aadhaar: 'documents.aadhaar',
  pan: 'documents.pan',
  bank_passbook: 'documents.bank_passbook',
  income_certificate: 'documents.income_certificate',
};

const DOC_ICONS: Record<DocType, string> = {
  aadhaar: '🆔',
  pan: '💳',
  bank_passbook: '🏦',
  income_certificate: '📄',
};

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
    icon: DOC_ICONS[type as DocType],
  })));
  const [selectedType, setSelectedType] = useState<DocType>('aadhaar');
  const [processingSlowHint, setProcessingSlowHint] = useState(false);
  const [processingTimeout, setProcessingTimeout] = useState(false);
  const [processingDocId, setProcessingDocId] = useState<string | null>(null);
  const [processingDocType, setProcessingDocType] = useState<DocType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const userId = user?.id ?? 'demo-user-1';

  const POLL_INTERVAL_MS = 4000;
  const MAX_POLL_MS = 90000;
  const SLOW_HINT_MS = 5000;

  const checkDocumentStatus = async (documentId: string, documentType: DocType) => {
    try {
      const res = await getDocumentStatus(documentId);
      const status = res.data?.status ?? 'processing';
      const structured_data = res.data?.structured_data;
      setDocs((prev) => prev.map((d) => (d.type === documentType ? { ...d, status, structured_data } : d)));
      if (status === 'processed') {
        setProcessingId(null);
        setProcessingDocId(null);
        setProcessingDocType(null);
        setProcessingTimeout(false);
        setProcessingSlowHint(false);
      }
      return status === 'processed';
    } catch {
      return false;
    }
  };

  const uploadFile = async (file: File) => {
    const documentType = selectedType;
    setUploading(true);
    setUploadProgress(0);
    setProcessingSlowHint(false);
    setProcessingTimeout(false);
    try {
      const res = await requestDocumentUpload({
        userId,
        documentType,
        fileName: file.name,
        contentType: file.type,
      });
      const payload = (res as { data?: { documentId?: string; uploadUrl?: string } })?.data;
      const uploadUrl = payload?.uploadUrl;
      const documentId = payload?.documentId;
      if (!uploadUrl || !documentId) throw new Error('Upload failed');

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed'))));
        xhr.addEventListener('error', () => reject(new Error('Upload failed')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      setDocs((prev) => prev.map((d) => (d.type === documentType ? { ...d, documentId, status: 'processing', uploadedAt: new Date().toISOString() } : d)));
      setProcessingId(documentId);
      setProcessingDocId(documentId);
      setProcessingDocType(documentType);
      setUploadProgress(100);

      const slowHintTimer = setTimeout(() => setProcessingSlowHint(true), SLOW_HINT_MS);
      const pollStart = Date.now();
      const poll = async () => {
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          if (Date.now() - pollStart >= MAX_POLL_MS) {
            setProcessingTimeout(true);
            setProcessingId(null);
            break;
          }
          const done = await checkDocumentStatus(documentId, documentType);
          if (done) break;
        }
        clearTimeout(slowHintTimer);
        setProcessingSlowHint(false);
        setProcessingDocId(null);
        setProcessingDocType(null);
      };
      poll();
    } catch (e) {
      console.error(e);
    } finally {
      setUploading(false);
      setUploadProgress(0);
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
        className={`border-2 border-dashed rounded-card p-12 text-center transition-colors ${
          dragOver ? 'border-primary-500 bg-primary-50' : 'border-surface-border bg-surface-elevated'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <p className="text-text-secondary mb-2">📤 {t('documents.drag_drop')}</p>
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
        {docs.map((doc) => (
          <div
            key={doc.type}
            className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
          >
            <div className="text-3xl mb-2">{doc.icon}</div>
            <h3 className="font-semibold text-text-primary">{t(DOC_TYPE_KEYS[doc.type])}</h3>
            <p className={`text-sm mt-1 ${doc.status === 'processed' ? 'text-accent-500' : doc.status === 'processing' ? 'text-amber-600' : 'text-text-muted'}`}>
              {doc.status === 'processed' ? t('documents.verified') : doc.status === 'processing' ? t('documents.processing') : t('documents.not_uploaded')}
            </p>
            {doc.structured_data && Object.keys(doc.structured_data).length > 0 && (
              <div className="mt-4 p-3 bg-surface-elevated rounded-lg text-sm space-y-1">
                <p className="text-text-muted text-xs font-medium mb-1">{t('documents.extracted_data')}</p>
                {Object.entries(doc.structured_data).map(([k, v]) => (
                  <p key={k} className="text-text-secondary">
                    <span className="text-text-muted">{k}:</span> {String(v)}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
