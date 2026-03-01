import { NavLink } from 'react-router-dom';
import { Home, FileText, FolderOpen, Image, Bot } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../../contexts/LanguageContext';

const navRoutes = [
  { to: '/dashboard', icon: Home, key: 'nav.dashboard' },
  { to: '/schemes', icon: FileText, key: 'nav.schemes' },
  { to: '/applications', icon: FolderOpen, key: 'nav.applications' },
  { to: '/documents', icon: Image, key: 'nav.documents' },
  { to: '/agents', icon: Bot, key: 'nav.agents' },
];

export default function BottomNav() {
  const { t } = useLanguage();
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface-card border-t border-surface-border flex items-center justify-around z-40 safe-area-pb">
      {navRoutes.map(({ to, icon: Icon, key: labelKey }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            clsx(
              'flex flex-col items-center justify-center min-w-[44px] min-h-[44px] px-2 py-1 rounded-lg transition-colors',
              isActive ? 'text-primary-500' : 'text-text-muted hover:text-text-secondary'
            )
          }
        >
          <Icon className="w-6 h-6 shrink-0" aria-hidden />
          <span className="text-xs font-medium mt-0.5">{t(labelKey)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
