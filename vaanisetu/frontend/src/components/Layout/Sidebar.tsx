import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, FolderOpen, Image, Briefcase, User } from 'lucide-react';
import { clsx } from 'clsx';

interface SidebarProps {
  isOpen: boolean;
}

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/schemes', icon: FileText, label: 'Schemes' },
  { to: '/applications', icon: FolderOpen, label: 'Applications' },
  { to: '/documents', icon: Image, label: 'Documents' },
  { to: '/jobs', icon: Briefcase, label: 'Jobs' },
  { to: '/profile', icon: User, label: 'Profile' },
];

export default function Sidebar({ isOpen }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'bg-white border-r border-gray-200 transition-all duration-200 flex flex-col',
        isOpen ? 'w-56' : 'w-0 overflow-hidden lg:w-20'
      )}
    >
      <nav className="p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-600 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              )
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {isOpen && <span className="hidden sm:inline">{label}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
