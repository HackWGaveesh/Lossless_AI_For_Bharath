import React from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { clsx } from 'clsx';

const languages = [
  { code: 'en' as const, label: 'English' },
  { code: 'hi' as const, label: 'हिंदी' },
  { code: 'ta' as const, label: 'தமிழ்' },
  { code: 'te' as const, label: 'తెలుగు' },
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
            'px-3 py-1.5 text-sm font-medium transition-colors',
            language === code
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
