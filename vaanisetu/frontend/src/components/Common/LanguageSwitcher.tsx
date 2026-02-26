import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { clsx } from 'clsx';

const languages = [
  { code: 'en' as const, label: 'English' },
  { code: 'hi' as const, label: 'हिंदी' },
  { code: 'ta' as const, label: 'தமிழ்' },
  { code: 'te' as const, label: 'తెలుగు' },
  { code: 'mr' as const, label: 'मराठी' },
  { code: 'kn' as const, label: 'ಕನ್ನಡ' },
];

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden">
      {languages.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => setLanguage(code)}
          className={clsx(
            'px-3 py-1.5 text-sm font-medium transition-colors rounded-md',
            language === code
              ? 'bg-primary-500 text-white'
              : 'bg-surface-card text-text-secondary hover:bg-surface-elevated border border-surface-border'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
