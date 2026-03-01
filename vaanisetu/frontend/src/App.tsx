import React, { Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import { Skeleton } from './components/Common/Skeleton';
import Toast, { setToastHandler, type ToastType } from './components/Common/Toast';
import { useAuth } from './contexts/AuthContext';

const HomePage = React.lazy(() => import('./pages/HomePage'));
const LoginPage = React.lazy(() => import('./pages/LoginPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const SchemesPage = React.lazy(() => import('./pages/SchemesPage'));
const SchemeDetailPage = React.lazy(() => import('./pages/SchemeDetailPage'));
const ApplicationsPage = React.lazy(() => import('./pages/ApplicationsPage'));
const DocumentsPage = React.lazy(() => import('./pages/DocumentsPage'));
const JobsPage = React.lazy(() => import('./pages/JobsPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const AgentPage = React.lazy(() => import('./pages/AgentPage'));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage'));

function ProtectedLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

function App() {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  useEffect(() => {
    setToastHandler((message, type) => setToast({ message, type }));
  }, []);

  return (
    <Suspense fallback={<Skeleton fullScreen />}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/schemes" element={<SchemesPage />} />
          <Route path="/schemes/:schemeId" element={<SchemeDetailPage />} />
          <Route path="/applications" element={<ApplicationsPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/agents" element={<AgentPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
