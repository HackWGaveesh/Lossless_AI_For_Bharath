import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import BottomNav from './BottomNav';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
