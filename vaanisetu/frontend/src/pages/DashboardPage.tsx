import { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import StatsCard from '../components/Dashboard/StatsCard';
import ApplicationList from '../components/Dashboard/ApplicationList';
import RecentActivity from '../components/Dashboard/RecentActivity';
import QuickActions from '../components/Dashboard/QuickActions';
import VoiceWidget from '../components/Voice/VoiceWidget';
import { fetchUserStats, fetchApplications } from '../services/api';
import { api } from '../services/api';
import { FileText, Clock, CheckCircle, Briefcase } from 'lucide-react';
import { SkeletonCard } from '../components/Common/Skeleton';

interface HealthStatus {
  status?: string;
  checks?: { aurora?: { status?: string }; dynamodb?: { status?: string } };
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery('userStats', fetchUserStats);
  const { data: applications, isLoading: applicationsLoading } = useQuery('applications', () => fetchApplications());

  useEffect(() => {
    let cancelled = false;
    api.get<{ data?: HealthStatus }>('/health').then((res) => {
      if (!cancelled) setHealth(res.data?.data ?? null);
    }).catch(() => {
      if (!cancelled) setHealth(null);
    });
    const t = setInterval(() => {
      api.get<{ data?: HealthStatus }>('/health').then((res) => {
        if (!cancelled) setHealth(res.data?.data ?? null);
      }).catch(() => {
        if (!cancelled) setHealth(null);
      });
    }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const appList = Array.isArray(applications) ? applications : [];
  const pendingAction = appList.find((a: { status?: string }) => a.status === 'submitted' || a.status === 'pending');

  if (statsLoading || applicationsLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-surface-card p-6 rounded-card shadow-card border border-surface-border">
        <h1 className="font-display text-2xl font-bold text-text-primary">
          {t('dashboard.greeting')}, {user?.name ?? 'User'}! 👋
        </h1>
        <p className="text-text-secondary mt-2 font-sans">
          {pendingAction
            ? `${t('dashboard.pending_action')}: ${pendingAction.application_id} — ${pendingAction.scheme_id}`
            : t('dashboard.no_applications')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title={t('dashboard.active_applications')}
          value={stats?.activeApplications ?? 0}
          icon={<FileText className="w-6 h-6" />}
          color="blue"
        />
        <StatsCard
          title={t('dashboard.pending_review')}
          value={stats?.pendingApplications ?? 0}
          icon={<Clock className="w-6 h-6" />}
          color="yellow"
        />
        <StatsCard
          title={t('dashboard.approved')}
          value={stats?.approvedApplications ?? 0}
          icon={<CheckCircle className="w-6 h-6" />}
          color="green"
        />
        <StatsCard
          title={t('dashboard.job_matches')}
          value={stats?.jobMatches ?? 0}
          icon={<Briefcase className="w-6 h-6" />}
          color="purple"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <ApplicationList applications={appList} />
        </div>
        <div className="space-y-6">
          <QuickActions />
          <RecentActivity />
        </div>
      </div>

      {health && (
        <div className="bg-surface-card border border-surface-border rounded-card p-4 shadow-card">
          <h3 className="font-display font-semibold text-text-primary mb-2">{t('dashboard.system_status')}</h3>
          <div className="flex flex-wrap gap-4 text-sm font-sans">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${health.checks?.aurora?.status === 'up' ? 'bg-green-700' : 'bg-red-700'}`} />
              Aurora
            </span>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${health.checks?.dynamodb?.status === 'up' ? 'bg-green-700' : 'bg-red-700'}`} />
              DynamoDB
            </span>
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${health.status === 'ok' ? 'bg-green-700' : 'bg-red-700'}`} />
              API
            </span>
          </div>
          {health.status === 'ok' && health.checks?.aurora?.status === 'up' && health.checks?.dynamodb?.status === 'up' && (
            <p className="text-sm text-green-700 mt-2">{t('dashboard.all_systems_ok')} ✅</p>
          )}
        </div>
      )}

      <VoiceWidget />
    </div>
  );
}
