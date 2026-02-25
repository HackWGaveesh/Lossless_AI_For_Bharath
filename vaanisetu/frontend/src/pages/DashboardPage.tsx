import React from 'react';
import { useQuery } from 'react-query';
import { useAuth } from '../contexts/AuthContext';
import StatsCard from '../components/Dashboard/StatsCard';
import ApplicationList from '../components/Dashboard/ApplicationList';
import RecentActivity from '../components/Dashboard/RecentActivity';
import QuickActions from '../components/Dashboard/QuickActions';
import VoiceWidget from '../components/Voice/VoiceWidget';
import { fetchUserStats, fetchApplications } from '../services/api';
import { FileText, Clock, CheckCircle, Briefcase } from 'lucide-react';

export default function DashboardPage() {
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery('userStats', fetchUserStats);
  const { data: applications, isLoading: applicationsLoading } = useQuery('applications', fetchApplications);

  if (statsLoading || applicationsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="bg-white p-6 rounded-lg shadow border border-gray-100">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {user?.name ?? 'User'}! 👋
        </h1>
        <p className="text-gray-600 mt-2">
          Your next action: Upload income certificate for MUDRA loan application
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Active Applications"
          value={stats?.activeApplications ?? 3}
          icon={<FileText className="w-6 h-6" />}
          color="blue"
        />
        <StatsCard
          title="Pending Review"
          value={stats?.pendingApplications ?? 2}
          icon={<Clock className="w-6 h-6" />}
          color="yellow"
        />
        <StatsCard
          title="Approved"
          value={stats?.approvedApplications ?? 1}
          icon={<CheckCircle className="w-6 h-6" />}
          color="green"
        />
        <StatsCard
          title="Job Matches"
          value={stats?.jobMatches ?? 5}
          icon={<Briefcase className="w-6 h-6" />}
          color="purple"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <ApplicationList applications={applications ?? []} />
        </div>
        <div className="space-y-6">
          <QuickActions />
          <RecentActivity />
        </div>
      </div>

      <VoiceWidget />
    </div>
  );
}
