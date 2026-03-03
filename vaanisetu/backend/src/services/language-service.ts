export type LanguageCode = 'en' | 'hi' | 'ta' | 'te' | 'mr' | 'kn';

export function normalizeLanguageTag(tag: string | undefined | null, fallback: LanguageCode = 'en'): LanguageCode {
  if (!tag) return fallback;
  const lower = tag.toLowerCase();
  const map: Record<string, LanguageCode> = {
    en: 'en',
    'en-in': 'en',
    'en-us': 'en',
    hi: 'hi',
    'hi-in': 'hi',
    ta: 'ta',
    'ta-in': 'ta',
    te: 'te',
    'te-in': 'te',
    mr: 'mr',
    'mr-in': 'mr',
    kn: 'kn',
    'kn-in': 'kn',
  };
  return map[lower] || fallback;
}

export function toBcp47(lang: LanguageCode): string {
  const map: Record<LanguageCode, string> = {
    en: 'en-IN',
    hi: 'hi-IN',
    ta: 'ta-IN',
    te: 'te-IN',
    mr: 'mr-IN',
    kn: 'kn-IN',
  };
  return map[lang] ?? 'en-IN';
}

export function getLangLabel(languageTag: string): string {
  const lang = normalizeLanguageTag(languageTag);
  const map: Record<LanguageCode, string> = {
    hi: 'Hindi',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    kn: 'Kannada',
    en: 'English',
  };
  return map[lang] || 'English';
}

export function detectLanguageFromTranscript(transcript: string, fallback: LanguageCode = 'en'): LanguageCode {
  const text = (transcript || '').trim();
  if (!text) return fallback;

  // Simple script-based detection
  if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Devanagari (Hindi, Marathi etc.) – default to Hindi
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu (and related); default to Telugu
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn'; // Kannada

  // Latin script heuristics
  const lower = text.toLowerCase();
  if (/\bnamaste\b|\bkaise ho\b|\byojana\b|\bsarkari\b/.test(lower)) return 'hi';

  return fallback;
}

export async function translateText(
  text: string,
  _from: LanguageCode,
  _to: LanguageCode,
  _domain: 'ui' | 'assistant' | 'system' = 'assistant',
): Promise<string> {
  // Placeholder: right now we rely on Bedrock prompts to answer directly in the target language.
  // This is kept as an async function so we can later plug in a Bedrock translation model.
  return text;
}

