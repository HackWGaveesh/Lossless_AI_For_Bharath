import React from 'react';
import { Link } from 'react-router-dom';
import { Menu, Bell, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import LanguageSwitcher from '../Common/LanguageSwitcher';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { user } = useAuth();

  return (
    <header className="bg-surface-card border-b border-surface-border px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg hover:bg-surface-elevated lg:hidden"
          aria-label="Toggle menu"
        >
          <Menu className="w-6 h-6 text-text-secondary" />
        </button>
        <Link to="/dashboard" className="font-display text-xl font-semibold text-primary-500">
          वाणी<span className="font-sans font-medium text-text-primary">Setu</span>
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <LanguageSwitcher />
        <button
          className="p-2 rounded-lg hover:bg-surface-elevated relative"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-text-secondary" />
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" aria-hidden />
        </button>
        <Link
          to="/profile"
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-elevated"
        >
          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
            <User className="w-4 h-4 text-primary-500" />
          </div>
          <span className="hidden sm:inline font-medium text-text-primary">{user?.name ?? 'User'}</span>
        </Link>
      </div>
    </header>
  );
}
