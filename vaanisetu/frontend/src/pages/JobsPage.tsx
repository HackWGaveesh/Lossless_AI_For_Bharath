import { useState } from 'react';
import { useQuery } from 'react-query';
import { fetchJobs, matchJobs, fetchProfile, type Job } from '../services/api';
import Button from '../components/Common/Button';
import { SkeletonCard } from '../components/Common/Skeleton';
import { useLanguage } from '../contexts/LanguageContext';

const JOB_TYPE_KEYS = ['jobs.type_all', 'jobs.full_time', 'jobs.part_time', 'jobs.gig', 'jobs.contract'] as const;
const JOB_TYPES = ['All', 'Full-time', 'Part-time', 'Gig', 'Contract'];
const STATE_OPTIONS = ['', 'Bihar', 'Rajasthan', 'Tamil Nadu', 'Uttar Pradesh', 'Maharashtra'];

function companyInitial(name: string): string {
  if (!name || !name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name[0].toUpperCase();
}

function companyColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h << 5) - h + name.charCodeAt(i);
  const hue = Math.abs(h % 360);
  return `hsl(${hue}, 55%, 40%)`;
}

export default function JobsPage() {
  const { t } = useLanguage();
  const [state, setState] = useState('');
  const [jobType, setJobType] = useState('All');
  const [matchedJobs, setMatchedJobs] = useState<(Job & { matchScore?: number; matchReason?: string })[] | null>(null);
  const [matching, setMatching] = useState(false);

  const { data, isLoading } = useQuery(
    ['jobs', state, jobType],
    () => fetchJobs({
      state: state || undefined,
      type: jobType === 'All' ? undefined : jobType,
      limit: 20,
    })
  );

  const jobs: Job[] = data?.data?.jobs ?? [];
  const handleFindMatches = async () => {
    setMatching(true);
    setMatchedJobs(null);
    try {
      const profileRes = await fetchProfile();
      const profile = (profileRes?.data?.profile ?? {}) as Record<string, unknown>;
      const res = await matchJobs(profile);
      const list = (res?.data?.jobs ?? []) as (Job & { matchScore?: number; matchReason?: string })[];
      setMatchedJobs(list);
    } catch {
      setMatchedJobs([]);
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-text-primary">{t('jobs.title')}</h1>
        <p className="text-text-secondary mt-1">{t('jobs.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <select
          value={state}
          onChange={(e) => setState(e.target.value)}
          className="rounded-lg border border-surface-border bg-surface-bg px-4 py-2 text-text-primary font-sans"
        >
          <option value="">{t('jobs.all_states')}</option>
          {STATE_OPTIONS.filter(Boolean).map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <div className="flex gap-2 flex-wrap">
          {JOB_TYPES.map((jt, idx) => (
            <button
              key={jt}
              type="button"
              onClick={() => setJobType(jt)}
              className={`px-3 py-2 rounded-full text-sm font-medium border-2 transition-colors ${
                jobType === jt ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-surface-border bg-surface-card text-text-secondary hover:border-primary-300'
              }`}
            >
              {t(JOB_TYPE_KEYS[idx])}
            </button>
          ))}
        </div>
        <Button onClick={handleFindMatches} disabled={matching}>
          {matching ? t('jobs.loading') : t('jobs.find_matches')}
        </Button>
      </div>

      {matchedJobs !== null && matchedJobs.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold text-text-primary mb-4">{t('jobs.for_you')}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {matchedJobs.map((job) => (
              <JobCard key={job.jobId ?? `${job.title}-${job.company}`} job={job} showMatch />
            ))}
          </div>
        </section>
      )}

      <section>
        {(matchedJobs !== null || jobs.length > 0) && <h2 className="font-display text-lg font-semibold text-text-primary mb-4">{t('jobs.all_jobs')}</h2>}
        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="bg-surface-card border border-surface-border rounded-card p-12 text-center">
            <p className="text-text-muted mb-2">{t('jobs.no_jobs')}</p>
            <svg className="mx-auto w-16 h-16 text-surface-border mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <JobCard key={job.jobId ?? `${job.title}-${job.company}`} job={job} showMatch={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function JobCard({ job, showMatch }: { job: Job & { matchScore?: number; matchReason?: string }; showMatch?: boolean }) {
  const { t } = useLanguage();
  const initial = companyInitial(job.company ?? '');
  const color = companyColor(job.company ?? '');

  return (
    <div className="bg-surface-card rounded-xl border border-surface-border p-6 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-display font-semibold text-text-primary">{job.title}</h3>
          <p className="text-sm text-text-secondary">{job.company}</p>
          <p className="text-sm text-text-muted mt-1">
            📍 {[job.district, job.state].filter(Boolean).join(', ') || '—'}
          </p>
          {(job.salaryMin != null || job.salaryMax != null) && (
            <p className="text-sm font-medium text-primary-600 mt-1">
              ₹{job.salaryMin ?? 0}–{job.salaryMax ?? 0}/month
            </p>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            {job.jobType && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-surface-elevated text-text-secondary">
                {job.jobType}
              </span>
            )}
          </div>
          {showMatch && job.matchScore != null && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-text-secondary">{t('jobs.ai_match')}</span>
                <span className="font-medium text-primary-600">{Math.round(job.matchScore)}%</span>
              </div>
              <div className="h-2 bg-surface-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, job.matchScore ?? 0)}%` }}
                />
              </div>
              {job.matchReason && (
                <p className="text-xs text-text-muted mt-1 line-clamp-2">{job.matchReason}</p>
              )}
            </div>
          )}
          <Button size="sm" className="mt-4">
            {t('jobs.apply')}
          </Button>
        </div>
      </div>
    </div>
  );
}
