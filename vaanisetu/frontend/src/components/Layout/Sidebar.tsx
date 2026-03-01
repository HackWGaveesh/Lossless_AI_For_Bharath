import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, FolderOpen, Image, Briefcase, User, Bot } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../../contexts/LanguageContext';

interface SidebarProps {
  isOpen: boolean;
}

const navRoutes = [
  { to: '/dashboard', icon: LayoutDashboard, key: 'nav.dashboard' },
  { to: '/schemes', icon: FileText, key: 'nav.schemes' },
  { to: '/applications', icon: FolderOpen, key: 'nav.applications' },
  { to: '/documents', icon: Image, key: 'nav.documents' },
  { to: '/jobs', icon: Briefcase, key: 'nav.jobs' },
  { to: '/agents', icon: Bot, key: 'nav.agents' },
  { to: '/profile', icon: User, key: 'nav.profile' },
];

export default function Sidebar({ isOpen }: SidebarProps) {
  const { t } = useLanguage();
  return (
    <aside
      className={clsx(
        'bg-[#1A1208] border-r border-white/10 transition-all duration-200 flex flex-col',
        isOpen ? 'w-56' : 'w-0 overflow-hidden lg:w-20'
      )}
    >
      <nav className="p-4 space-y-1">
        {navRoutes.map(({ to, icon: Icon, key: labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors border-l-4',
                isActive
                  ? 'border-primary-500 bg-primary-500/10 text-primary-300 font-medium'
                  : 'border-transparent text-text-muted hover:bg-white/5 hover:text-white/80'
              )
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {isOpen && <span className="hidden sm:inline">{t(labelKey)}</span>}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
