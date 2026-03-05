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

// ──────────────────────────────────────────────────────────────────────────
// Language detection from Unicode script ranges
// ──────────────────────────────────────────────────────────────────────────

export function detectLanguageHint(transcript: string): 'hi' | 'ta' | 'te' | 'kn' | 'mr' | 'en' | null {
  if (!transcript) return null;
  const counts = { devanagari: 0, tamil: 0, telugu: 0, kannada: 0 };
  for (const ch of transcript) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x0900 && cp <= 0x097F) counts.devanagari++;
    if (cp >= 0x0B80 && cp <= 0x0BFF) counts.tamil++;
    if (cp >= 0x0C00 && cp <= 0x0C7F) counts.telugu++;
    if (cp >= 0x0C80 && cp <= 0x0CFF) counts.kannada++;
  }
  const total = counts.devanagari + counts.tamil + counts.telugu + counts.kannada;
  if (total < 3) return null; // not enough signal
  if (counts.tamil > counts.devanagari && counts.tamil > counts.telugu && counts.tamil > counts.kannada) return 'ta';
  if (counts.telugu > counts.devanagari && counts.telugu > counts.tamil && counts.telugu > counts.kannada) return 'te';
  if (counts.kannada > counts.devanagari && counts.kannada > counts.tamil && counts.kannada > counts.telugu) return 'kn';
  if (counts.devanagari > 0) {
    // Marathi-specific words
    const marathi = /\b(मी|आहे|आणि|माझी|माझ्या|नाही|हे|ते|तो|ती|मला|तुम्ही)\b/.test(transcript);
    return marathi ? 'mr' : 'hi';
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Greeting patterns (EN + HI + TA + TE + MR + KN + Romanized)
// ──────────────────────────────────────────────────────────────────────────

const GREETING_PATTERNS = [
  /\b(hi|hello|hey|namaste|namaskar|greetings)\b/i,
  /\b(kaise ho|kya haal|aap kaise hain)\b/i,
  /\b(sup|what's up|good morning|good evening|good afternoon)\b/i,
  /नमस्ते|नमस्कार/,                           // Devanagari (HI/MR)
  /वाझ्कम्|இல்லை/,                             // Tamil (extended)
  /வணக்கம்/,                                    // Tamil greeting
  /\b(vanakkam)\b/i,                            // Tamil romanized
  /నమస్తే|నమస్కారం/,                           // Telugu
  /\b(namaskaram)\b/i,                          // Telugu romanized
  /ನಮಸ್ಕಾರ/,                                   // Kannada
  /\b(namaskara)\b/i,                           // Kannada romanized
];

// ──────────────────────────────────────────────────────────────────────────
// Intent detection with comprehensive multilingual patterns
// ──────────────────────────────────────────────────────────────────────────

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

  // STATUS — expanded with Tamil/Telugu/Kannada/Marathi
  const isStatus = hasRef
    || /\b(status|track|tracking)\b/.test(normalized)
    || /\bmy applications?\b|\bcheck application|\bapplication status\b/.test(normalized)
    || /\b(aavedan sthiti|sthiti|nila|nilakada)\b/.test(normalized)
    || /\b(status check|status batao|mera status|nila)\b/i.test(normalized)
    || (/[\u0905-\u0939]/.test(normalized) && /\u0938\u094d\u0925\u093f\u0924\u093f|\u0906\u0935\u0947\u0926\u0928/.test(normalized))
    // Tamil status
    || /நிலை|விண்ணப்பம் நிலை/.test(normalized)
    || /\b(status paar|thirumbu)\b/i.test(normalized)
    // Telugu status
    || /స్థితి|దరఖాస్తు స్థితి|నా అప్లికేషన్ ఏమైంది/.test(normalized)
    || /\b(status chekku)\b/i.test(normalized)
    // Kannada status
    || /ಸ್ಥಿತಿ|ಅರ್ಜಿ ಸ್ಥಿತಿ/.test(normalized)
    // Marathi status
    || /स्थिती|अर्जाची स्थिती|माझा अर्ज कुठे आहे/.test(normalized);

  // LANGUAGE UPDATE
  const isLanguageUpdate = /\b(change|set|update)\b.*\b(language|lang)\b|\bdefault language\b/.test(normalized)
    || /\b(hindi mein|english mein|tamil mein|telugu mein|marathi mein|kannada mein)\b/.test(normalized)
    || /\u092d\u093e\u0937\u093e \u092c\u0926\u0932|\u092d\u093e\u0937\u093e \u092a\u094d\u0930\u0947\u092b\u0930|\u0baa\u0b9e\u0bcd\u0b9a\u0bc8 \u0bae\u0bbe\u0bb1\u0bcd\u0bb1\u0bc1/.test(normalized);

  // PROFILE UPDATE — expanded with all Indian languages
  const isProfileUpdate = /\b(update|change|edit)\b.*\b(profile|age|income|occupation|state|district|gender|caste)\b/.test(normalized)
    || /\b(meri umar|mera income|meri jati|mera pesa|update karo|update karen)\b/.test(normalized)
    || /\b(my age is|i am \s*\d{1,3}|age is \d|state is|i am from|from [a-z ]{2,25}|district is)\b/.test(normalized)
    || /\b(meri age|mera state|meri info|years old)\b/i.test(normalized)
    || /\u092a\u094d\u0930\u094b\u092b\u093e\u0907\u0932 \u0905\u092a\u0921\u0947\u091f|\u0906\u092f\u0941 \u092c\u0926\u0932\u0947\u0902/.test(normalized)
    // Tamil profile
    || /என் விவரங்கள்|வயது|மாநிலம்/.test(normalized)
    || /\b(naan.*ettu|en age)\b/i.test(normalized)
    // Telugu profile
    || /నా వివరాలు|వయసు|రాష్ట్రం/.test(normalized)
    || /\b(naa age)\b/i.test(normalized)
    // Kannada profile
    || /ನನ್ನ ವಿವರ|ವಯಸ್ಸು/.test(normalized)
    || /\b(nanna age)\b/i.test(normalized)
    // Marathi profile
    || /माझी माहिती|वय|राज्य|माझे वय/.test(normalized);

  // APPLY — expanded with all Indian languages
  const isApply = /\b(apply|submit|register)\b/.test(normalized)
    || /\b(i want to apply|want to apply|apply for this|apply this|apply now)\b/.test(normalized)
    || /\b(aavedan kare|aavedan karen|apply karo)\b/.test(normalized)
    || /\b(apply karo|apply karna|aavedan karo|darkhast)\b/i.test(normalized)
    // Hindi apply
    || /आवेदन करना|आवेदन करना है|मुझे अप्लाई करना है|अप्लाई करो|फॉर्म भरना/.test(normalized)
    || /\u0906\u0935\u0947\u0926\u0928 \u0915\u0930\u0947\u0902|\u0905\u0930\u094d\u091c \u0915\u0930\u093e/.test(normalized)
    // Tamil apply
    || /விண்ணப்பிக்க|விண்ணப்பம்|பதிவு செய்ய/.test(normalized)
    || /\b(apply pannanum|apply panna)\b/i.test(normalized)
    // Telugu apply
    || /దరఖాస్తు చేయాలి|అప్లై చేయాలి|దరఖాస్తు/.test(normalized)
    || /\b(apply cheyali)\b/i.test(normalized)
    // Kannada apply
    || /ಅರ್ಜಿ ಸಲ್ಲಿಸು|ಅರ್ಜಿ ಮಾಡು/.test(normalized)
    || /\b(apply madu)\b/i.test(normalized)
    // Marathi apply
    || /अर्ज करायचा|अर्ज द्यायचा|अर्ज करणे|अर्ज करायचे/.test(normalized)
    || (/\b(application|\u0906\u0935\u0947\u0926\u0928)\b/.test(normalized) && !isStatus);

  // JOBS — expanded with all Indian languages
  const isJobs = /\b(job|jobs|vacancy|work)\b/.test(normalized)
    || (/\bemployment\b/.test(normalized) && !/\b(generation|programme|program|guarantee)\b/.test(normalized))
    || /\b(rojgar|naukri|kaam dhanda|kaam)\b/.test(normalized)
    || /\b(naukri|kaam chahiye|rojgar|job chahiye)\b/i.test(normalized)
    || /\u0930\u094b\u091c\u0917\u093e\u0930|\u0928\u094c\u0915\u0930\u0940/.test(normalized)
    // Hindi jobs
    || /रोजगार|काम चाहिए|नौकरी चाहिए/.test(normalized)
    // Tamil jobs
    || /வேலை|வேலைவாய்ப்பு/.test(normalized)
    || /\b(job vendum|velai thedi)\b/i.test(normalized)
    // Telugu jobs
    || /ఉద్యోగం|ఉద్యోగాలు/.test(normalized)
    || /\b(job kavali|pani kavali)\b/i.test(normalized)
    // Kannada jobs
    || /ಉದ್ಯೋಗ|ಕೆಲಸ/.test(normalized)
    || /\b(job beku|kelasa beku)\b/i.test(normalized)
    // Marathi jobs
    || /नोकरी|काम|रोजगार|नोकरी हवी/.test(normalized);

  // DOCUMENTS
  const isDocuments = /\b(document|documents|doc|upload|reupload|aadhaar|aadhar|pan|passbook|certificate)\b/.test(normalized)
    || /\b(kagaz|dastavez|document upload|proof)\b/.test(normalized)
    || /\u0926\u0938\u094d\u0924\u093e\u0935\u0947\u091c|\u0915\u093e\u0917\u091c/.test(normalized);

  // SCHEMES — expanded with all Indian languages
  const isSchemes = /\b(scheme|schemes|yojana|yojna|benefit|eligible|eligibility|sarkar|government scheme)\b/.test(normalized)
    || /\b(kaunsi yojana|konsi yojana|mujhe yojana|koi yojana|tell me about schemes|schemes available)\b/.test(normalized)
    || /\b(yojana|yojnaye|scheme|schemes|tirattam|pathakam)\b/i.test(normalized)
    || /\u092f\u094b\u091c\u0928\u093e|\u0932\u093e\u092d|\u092a\u093e\u0924\u094d\u0930\u0924\u093e/.test(normalized)
    // Hindi schemes
    || /योजनाएं|योजना|कौन सी योजना|सरकारी योजना|मुझे बताओ|कौन सी/.test(normalized)
    // Tamil schemes
    || /திட்டங்கள்|திட்டம்|யோஜனை|நல திட்டம்|திட்ட/.test(normalized)
    || /\b(government scheme|yojana)\b/i.test(normalized)
    // Telugu schemes
    || /పథకాలు|యోజన|పథకం|ప్రభుత్వ పథకాలు/.test(normalized)
    || /\b(tirattam)\b/i.test(normalized)
    // Kannada schemes
    || /ಯೋಜನೆಗಳು|ಯೋಜನೆ|ಸರ್ಕಾರಿ ಯೋಜನೆ/.test(normalized)
    // Marathi schemes
    || /योजना|सरकारी योजना|कोणत्या योजना|योजने/.test(normalized);

  // SCHEME DETAILS
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
