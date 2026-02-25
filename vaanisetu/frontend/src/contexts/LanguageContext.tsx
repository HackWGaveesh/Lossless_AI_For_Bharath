import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

type Language = 'en' | 'hi' | 'ta' | 'te';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
  en: {
    welcome: 'Welcome',
    dashboard: 'Dashboard',
    schemes: 'Schemes',
    applications: 'Applications',
    documents: 'Documents',
    jobs: 'Jobs',
    profile: 'Profile',
  },
  hi: {
    welcome: 'स्वागत है',
    dashboard: 'डैशबोर्ड',
    schemes: 'योजनाएं',
    applications: 'आवेदन',
    documents: 'दस्तावेज़',
    jobs: 'नौकरियां',
    profile: 'प्रोफ़ाइल',
  },
  ta: {
    welcome: 'வரவேற்பு',
    dashboard: 'டாஷ்போர்டு',
    schemes: 'திட்டங்கள்',
    applications: 'விண்ணப்பங்கள்',
    documents: 'ஆவணங்கள்',
    jobs: 'வேலைகள்',
    profile: 'சுயவிவரம்',
  },
  te: {
    welcome: 'స్వాగతం',
    dashboard: 'డాష్‌బోర్డ్',
    schemes: 'యోజనలు',
    applications: 'దరఖాస్తులు',
    documents: 'పత్రాలు',
    jobs: 'ఉద్యోగాలు',
    profile: 'ప్రొఫైల్',
  },
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');

  const setLanguage = useCallback((lang: Language) => setLanguageState(lang), []);

  const t = useCallback(
    (key: string) => translations[language][key] ?? translations.en[key] ?? key,
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
