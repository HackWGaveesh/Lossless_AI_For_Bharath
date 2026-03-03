import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import BottomNav from './BottomNav';
import { fetchProfile } from '../../services/api';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { setLanguage } = useLanguage();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    fetchProfile()
      .then((res) => {
        if (cancelled) return;
        const p = (res as any)?.data?.profile || {};
        const preferred = String(p.preferredLanguage || p.preferred_language || '').trim();
        if (['en', 'hi', 'ta', 'te', 'mr', 'kn'].includes(preferred)) {
          setLanguage(preferred as any);
        }
      })
      .catch(() => { /* noop */ });
    return () => { cancelled = true; };
  }, [isAuthenticated, setLanguage]);

  return (
    <div className="min-h-screen bg-surface-bg flex flex-col">
      <Header onMenuClick={() => setSidebarOpen((o) => !o)} />
      <div className="flex flex-1">
        <div className="hidden md:block">
          <Sidebar isOpen={sidebarOpen} />
        </div>
        <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>
      <Footer />
      <BottomNav />
    </div>
  );
}
