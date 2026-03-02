import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { translations, getTranslation, type Language } from '../i18n/translations';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export type { Language };
const LANG_KEY = 'vaanisetu_language';
const ALLOWED: Language[] = ['en', 'hi', 'ta', 'te', 'mr', 'kn'];

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = localStorage.getItem(LANG_KEY) as Language | null;
    return stored && ALLOWED.includes(stored) ? stored : 'en';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== 'undefined') localStorage.setItem(LANG_KEY, lang);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem(LANG_KEY) as Language | null;
    if (stored && ALLOWED.includes(stored) && stored !== language) {
      setLanguageState(stored);
    }
  }, []);

  const t = useCallback(
    (key: string) => getTranslation(language, key),
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
