/**
 * Intent detection for assistant workflow.
 * Language-agnostic: normalizes text and matches phrases in multiple scripts/languages.
 */

export type WorkflowIntent =
  | 'greeting'
  | 'apply'
  | 'status'
  | 'jobs'
  | 'documents'
  | 'schemes'
  | 'scheme_lookup'
  | 'scheme_detail'
  | 'profile_update'
  | 'language_update'
  | 'none';

export interface IntentResult {
  intent: WorkflowIntent;
  confidence: number;
}

export function normalizeText(value: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Greeting phrases (EN + HI + TA + TE + MR + KN) so "hi" / "namaste" get a quick welcome without model call */
const GREETING_PATTERNS = [
  /\b(hi|hello|hey|namaste|namaskar|greetings)\b/i,
  /\b(kaise ho|kya haal|aap kaise hain)\b/i,
  /\u0928\u092e\u0938\u094d\u0924\u0947|\u0928\u092e\u0938\u094d\u0915\u093e\u0930/, // Devanagari
  /\u0bb5\u0bbe\u0bb4\u0bcd\u0b95\u0bae\u0bcd|\u0b87\u0bb2\u0bcd\u0bb2\u0bc8/,   // Tamil
  /\u0c28\u0c2e\u0c38\u0c4d\u0c24\u0c47|\u0c28\u0c2e\u0c38\u0c4d\u0c15\u0c3e\u0c30\u0c02/, // Telugu
  /\u0ca8\u0cae\u0cb8\u0ccd\u0c95\u0cbe\u0cb0/, // Kannada
];

export function detectWorkflowIntent(normalized: string): WorkflowIntent {
  const t = normalized.trim();
  if (t.length <= 2) return 'none';

  // Greeting: short or explicit greeting phrases (check early so "hi" doesn't fall through)
  if (t.length <= 30) {
    for (const p of GREETING_PATTERNS) {
      if (p.test(t)) return 'greeting';
    }
    if (/^(hi|hello|hey|namaste|namaskar|greetings)$/i.test(t)) return 'greeting';
  }

  const hasRef = /\bvs-[a-z0-9-]{6,}\b/i.test(normalized);
  const isExplicitConfirm = /\bconfirm\s+application\b/.test(normalized)
    || (/\b(confirm|proceed|yes proceed)\b/.test(normalized) && /\b(application|scheme|yojana)\b/.test(normalized));

  const isStatus = hasRef
    || /\b(status|track|tracking)\b/.test(normalized)
    || /\bmy applications?\b|\bcheck application|\bapplication status\b/.test(normalized)
    || /\b(aavedan sthiti|sthiti|nila|nilakada)\b/.test(normalized)
    || (/[\u0905-\u0939]/.test(normalized) && /\u0938\u094d\u0925\u093f\u0924\u093f|\u0906\u0935\u0947\u0926\u0928/.test(normalized));

  const isLanguageUpdate = /\b(change|set|update)\b.*\b(language|lang)\b|\bdefault language\b/.test(normalized)
    || /\b(hindi mein|english mein|tamil mein|telugu mein|marathi mein|kannada mein)\b/.test(normalized)
    || /\u092d\u093e\u0937\u093e \u092c\u0926\u0932|\u092d\u093e\u0937\u093e \u092a\u094d\u0930\u0947\u092b\u0930|\u0baa\u0b9e\u0bcd\u0b9a\u0bc8 \u0bae\u0bbe\u0bb1\u0bcd\u0bb1\u0bc1/.test(normalized);

  const isProfileUpdate = /\b(update|change|edit)\b.*\b(profile|age|income|occupation|state|district|gender|caste)\b/.test(normalized)
    || /\b(meri umar|mera income|meri jati|mera pesa|update karo|update karen)\b/.test(normalized)
    || /\b(my age is|i am \s*\d{1,3}|age is \d|state is|i am from|from [a-z ]{2,25}|district is)\b/.test(normalized)
    || /\u092a\u094d\u0930\u094b\u092b\u093e\u0907\u0932 \u0905\u092a\u0921\u0947\u091f|\u0906\u092f\u0941 \u092c\u0926\u0932\u0947\u0902/.test(normalized);

  const isApply = /\b(apply|submit|register)\b/.test(normalized)
    || /\b(i want to apply|want to apply|apply for this|apply this|apply now)\b/.test(normalized)
    || /\b(aavedan kare|aavedan karen|apply karo)\b/.test(normalized)
    || /\u0906\u0935\u0947\u0926\u0928 \u0915\u0930\u0947\u0902|\u0905\u0930\u094d\u091c \u0915\u0930\u093e|\u0c26\u0c30\u0c16\u0c3e\u0c38\u0c4d\u0c24\u0c41|\u0bb5\u0bbf\u0ba3\u0bcd\u0ba3\u0baa\u0bcd\u0baa\u0bbf\u0b95\u0bcd\u0b95|\u0c85\u0cb0\u0ccd\u0c9c\u0cbf/.test(normalized)
    || (/\b(application|\u0906\u0935\u0947\u0926\u0928)\b/.test(normalized) && !isStatus);

  const isJobs = /\b(job|jobs|vacancy|work)\b/.test(normalized)
    || (/\bemployment\b/.test(normalized) && !/\b(generation|programme|program|guarantee)\b/.test(normalized))
    || /\b(rojgar|naukri|kaam dhanda|kaam)\b/.test(normalized)
    || /\u0930\u094b\u091c\u0917\u093e\u0930|\u0928\u094c\u0915\u0930\u0940|\u0c09\u0c26\u0c4d\u0c2f\u0c4b\u0c17\u0c02|\u0bb5\u0bc7\u0bb2\u0bc8|\u0c89\u0ca6\u0ccd\u0caf\u0ccb\u0c97/.test(normalized);

  const isDocuments = /\b(document|documents|doc|upload|reupload|aadhaar|aadhar|pan|passbook|certificate)\b/.test(normalized)
    || /\b(kagaz|dastavez|document upload|proof)\b/.test(normalized)
    || /\u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c|\u0915\u093e\u0917\u091c/.test(normalized);

  const isSchemes = /\b(scheme|schemes|yojana|yojna|benefit|eligible|eligibility|sarkar|government scheme)\b/.test(normalized)
    || /\b(kaunsi yojana|konsi yojana|mujhe yojana|koi yojana|tell me about schemes|schemes available)\b/.test(normalized)
    || /\u092f\u094b\u091c\u0928\u093e|\u0932\u093e\u092d|\u092a\u093e\u0924\u094d\u0930\u0924\u093e|\u0ba4\u0bbf\u0b9f\u0bcd\u0b9f\u0bae\u0bcd|\u0c2a\u0c25\u0c15\u0c02|\u0caf\u0ccb\u0c9c\u0ca8\u0cc6/.test(normalized);

  const isSchemeDetails = /\b(detail|details|about|information|info)\b/.test(normalized)
    || /\u091c\u093e\u0928\u0915\u093e\u0930\u0940|\u0935\u093f\u0935\u0930\u0923|\u0ba4\u0b95\u0bb5\u0bb2\u0bcd|\u0c35\u0c3f\u0c35\u0c30\u0c3e\u0c32\u0c41|\u0cae\u0cbe\u0cb9\u0cbf\u0ca4\u0cbf/.test(normalized);

  const hasDevanagari = /[\u0900-\u097F]/.test(normalized);
  const hasDravidian = /[\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/.test(normalized);
  const likelySchemeName = /\b(pm|kisan|mudra|india|yojana|yojna|bharat|aawas|awas|stand|startup|ayushman|ujjwala|nrega|svanidhi|udyam|scholarship|subsidy|loan)\b/.test(normalized)
    || ((hasDevanagari || hasDravidian) && normalized.split(' ').filter(Boolean).length >= 2);

  if (isStatus) return 'status';
  if (isLanguageUpdate) return 'language_update';
  if (isProfileUpdate) return 'profile_update';
  if (isExplicitConfirm) return 'apply';
  if (isApply) return 'apply';
  if (isJobs) return 'jobs';
  if (isDocuments) return 'documents';
  if (isSchemes) return 'schemes';
  if (isSchemeDetails) return 'scheme_detail';
  if (likelySchemeName) return 'scheme_lookup';
  return 'none';
}

export function detectIntentWithConfidence(normalized: string): IntentResult {
  const intent = detectWorkflowIntent(normalized);
  const confidence = intent === 'none' ? 0 : 0.9;
  return { intent, confidence };
}
