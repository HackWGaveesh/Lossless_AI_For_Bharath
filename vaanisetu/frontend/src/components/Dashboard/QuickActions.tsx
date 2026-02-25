import React from 'react';
import { Link } from 'react-router-dom';
import { FileText, Upload, Search } from 'lucide-react';

const actions = [
  { to: '/schemes', icon: FileText, label: 'Browse Schemes' },
  { to: '/documents', icon: Upload, label: 'Upload Document' },
  { to: '/jobs', icon: Search, label: 'Find Jobs' },
];

export default function QuickActions() {
  return (
    <div className="bg-white rounded-lg shadow border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
      <div className="space-y-2">
        {actions.map(({ to, icon: Icon, label }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-primary-50 text-gray-700 hover:text-primary-600 transition-colors"
          >
            <Icon className="w-5 h-5 shrink-0" />
            <span className="font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
