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
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg hover:bg-gray-100 lg:hidden"
          aria-label="Toggle menu"
        >
          <Menu className="w-6 h-6 text-gray-600" />
        </button>
        <Link to="/dashboard" className="text-xl font-bold text-primary-600">
          VaaniSetu
        </Link>
      </div>
      <div className="flex items-center gap-4">
        <LanguageSwitcher />
        <button className="p-2 rounded-lg hover:bg-gray-100 relative" aria-label="Notifications">
          <Bell className="w-5 h-5 text-gray-600" />
        </button>
        <Link
          to="/profile"
          className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100"
        >
          <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
            <User className="w-4 h-4 text-primary-600" />
          </div>
          <span className="hidden sm:inline font-medium text-gray-700">{user?.name ?? 'User'}</span>
        </Link>
      </div>
    </header>
  );
}
