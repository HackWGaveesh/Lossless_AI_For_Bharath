export type AssistantState =
  | 'IDLE'
  | 'DISCOVERING_SCHEMES'
  | 'SCHEME_DISAMBIGUATION'
  | 'APPLY_DRAFTING'
  | 'APPLY_FIELD_CONFIRMATION'
  | 'APPLY_DOC_COLLECTION'
  | 'APPLY_SUBMIT_CONFIRMATION'
  | 'TRACKING_STATUS'
  | 'PROFILE_EDITING'
  | 'LANGUAGE_SWITCHING'
  | 'JOB_DISCOVERY';

export interface AssistantStateData {
  state: AssistantState;
  updatedAt: number;
  intent?: string;
  actionResultType?: string;
  pendingType?: string | null;
}

export function initialAssistantState(): AssistantStateData {
  return {
    state: 'IDLE',
    updatedAt: Date.now(),
  };
}

export function confirmIntentConfidence(normalizedTranscript: string): number {
  const text = normalizedTranscript.trim();
  if (!text) return 0;
  const veryStrong = [
    'confirm application',
    'yes confirm application',
    'go ahead submit',
    'submit application',
    'haan confirm',
    'haanji confirm',
  ];
  const strong = [
    'confirm',
    'yes proceed',
    'go ahead',
    'proceed',
    'yes submit',
    'haan',
    'haanji',
  ];
  if (veryStrong.some((x) => text.includes(x))) return 0.95;
  if (strong.some((x) => text.includes(x))) return 0.8;
  if (/\byes\b|\bok\b|\bokay\b/.test(text)) return 0.65;
  return 0.2;
}

export function deriveAssistantState(args: {
  current?: AssistantStateData | null;
  intent?: string | null;
  actionResultType?: string | null;
  pendingType?: string | null;
}): AssistantStateData {
  const current = args.current?.state || 'IDLE';
  const intent = String(args.intent || '').trim();
  const result = String(args.actionResultType || '').trim();
  const pendingType = args.pendingType || null;

  let next: AssistantState = current;

  if (result === 'submitted') next = 'IDLE';
  else if (result === 'scheme_disambiguation' || pendingType === 'scheme_disambiguation') next = 'SCHEME_DISAMBIGUATION';
  else if (pendingType === 'apply_field_confirmation') next = 'APPLY_FIELD_CONFIRMATION';
  else if (
    result === 'document_requirements_missing'
    || result === 'document_upload_slot'
    || result === 'document_verified'
  ) next = 'APPLY_DOC_COLLECTION';
  else if (result === 'prepare_apply' || pendingType === 'application_confirm') next = 'APPLY_SUBMIT_CONFIRMATION';
  else if (intent === 'status') next = 'TRACKING_STATUS';
  else if (intent === 'jobs') next = 'JOB_DISCOVERY';
  else if (intent === 'schemes' || intent === 'scheme_lookup' || intent === 'scheme_detail') next = 'DISCOVERING_SCHEMES';
  else if (intent === 'apply') next = 'APPLY_DRAFTING';
  else if (intent === 'profile_update') next = 'PROFILE_EDITING';
  else if (intent === 'language_update') next = 'LANGUAGE_SWITCHING';
  else if (!intent && !result) next = current;

  return {
    state: next,
    updatedAt: Date.now(),
    intent: intent || undefined,
    actionResultType: result || undefined,
    pendingType,
  };
}
