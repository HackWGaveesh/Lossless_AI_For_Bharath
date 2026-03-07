export type DocumentProcessingStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface DocumentProcessingStep {
  id: string;
  label: string;
  status: DocumentProcessingStepStatus;
  detail: string;
  timestamp?: string;
  result?: Record<string, unknown> | string[] | string;
}

const STEP_TEMPLATES: Array<Pick<DocumentProcessingStep, 'id' | 'label' | 'detail'>> = [
  { id: 'upload', label: 'Upload received', detail: 'Waiting for the AI pipeline to start.' },
  { id: 'file_validation', label: 'File validation', detail: 'Checking file format and readability.' },
  { id: 'text_extraction', label: 'Text extraction', detail: 'Reading the document with OCR.' },
  { id: 'field_structuring', label: 'Field structuring', detail: 'Turning OCR output into clean fields.' },
  { id: 'verification', label: 'Verification', detail: 'Final review before marking the document ready.' },
];

export function createDocumentProcessingSteps(now = new Date().toISOString()): DocumentProcessingStep[] {
  return STEP_TEMPLATES.map((step, index) => ({
    ...step,
    status: index === 0 ? 'in_progress' : 'pending',
    timestamp: index === 0 ? now : undefined,
  }));
}

export function normalizeDocumentProcessingSteps(
  steps?: unknown,
  now = new Date().toISOString(),
): DocumentProcessingStep[] {
  const input = Array.isArray(steps) ? steps : [];
  const existingById = new Map(
    input
      .filter((step): step is Partial<DocumentProcessingStep> & { id: string } => !!step && typeof step === 'object' && typeof (step as any).id === 'string')
      .map((step) => [step.id, step]),
  );

  return STEP_TEMPLATES.map((template, index) => {
    const existing = existingById.get(template.id);
    return {
      id: template.id,
      label: typeof existing?.label === 'string' ? existing.label : template.label,
      detail: typeof existing?.detail === 'string' ? existing.detail : template.detail,
      status: isStepStatus(existing?.status) ? existing.status : index === 0 ? 'in_progress' : 'pending',
      timestamp: typeof existing?.timestamp === 'string' ? existing.timestamp : index === 0 ? now : undefined,
      ...(existing?.result !== undefined ? { result: existing.result } : {}),
    };
  });
}

export function updateDocumentProcessingStep(
  steps: DocumentProcessingStep[] | undefined,
  stepId: string,
  update: Partial<Omit<DocumentProcessingStep, 'id' | 'label'>>,
  now = new Date().toISOString(),
): DocumentProcessingStep[] {
  return normalizeDocumentProcessingSteps(steps, now).map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      ...update,
      timestamp: update.timestamp ?? now,
    };
  });
}

function isStepStatus(value: unknown): value is DocumentProcessingStepStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'failed';
}
