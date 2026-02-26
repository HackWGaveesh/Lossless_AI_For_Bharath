import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from 'react-query';
import { fetchSchemes, type Scheme } from '../services/api';
import Button from '../components/Common/Button';
import { SkeletonCard } from '../components/Common/Skeleton';
import EligibilityCalculator from '../components/Schemes/EligibilityCalculator';
import { useLanguage } from '../contexts/LanguageContext';

const CATEGORY_KEYS: { value: string; key: string }[] = [
  { value: '', key: 'schemes.all_categories' },
  { value: 'agriculture', key: 'schemes.agriculture' },
  { value: 'financial_inclusion', key: 'schemes.financial_inclusion' },
  { value: 'health', key: 'schemes.health' },
  { value: 'housing', key: 'schemes.housing' },
  { value: 'education', key: 'schemes.education' },
  { value: 'employment', key: 'schemes.employment' },
  { value: 'social_welfare', key: 'schemes.social_welfare' },
];

export default function SchemesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [category, setCategory] = useState<string>('');

  const { data, isLoading } = useQuery(
    ['schemes', category],
    () => fetchSchemes({ category: category || undefined, limit: 50 })
  );

  const schemes: Scheme[] = data?.data?.schemes ?? [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-text-primary">{t('schemes.title')}</h1>

      <div className="bg-surface-card border border-surface-border rounded-card p-6 shadow-card">
        <h2 className="font-display text-lg font-semibold text-text-primary mb-2">{t('schemes.find_for_you')}</h2>
        <p className="text-sm text-text-secondary mb-4">{t('schemes.find_subtitle')}</p>
        <EligibilityCalculator />
      </div>

      <div className="flex gap-4 flex-wrap">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary font-sans"
        >
          {CATEGORY_KEYS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.key)}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : schemes.length === 0 ? (
        <div className="bg-surface-card rounded-card shadow-card p-12 text-center text-text-muted border border-surface-border">
          <p>{t('schemes.no_schemes')}</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schemes.map((scheme) => (
            <div
              key={scheme.schemeId}
              className="bg-surface-card rounded-xl border border-surface-border p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200"
            >
              <h3 className="font-display text-lg font-semibold text-text-primary">{scheme.nameEn ?? scheme.schemeId}</h3>
              {scheme.nameHi && (
                <p className="text-sm text-text-secondary mt-1">{scheme.nameHi}</p>
              )}
              <p className="text-text-secondary mt-2 text-sm line-clamp-2">{scheme.description}</p>
              {(scheme.benefitAmountMin != null || scheme.benefitAmountMax != null) && (
                <p className="text-primary-600 font-medium mt-2">
                  ₹{scheme.benefitAmountMin ?? 0} – ₹{scheme.benefitAmountMax ?? 0}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigate(`/schemes/${scheme.schemeId}`)}>
                  {t('schemes.view_details')}
                </Button>
                <Button size="sm" onClick={() => navigate(`/schemes/${scheme.schemeId}?action=apply`)}>
                  {t('schemes.apply_now')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
