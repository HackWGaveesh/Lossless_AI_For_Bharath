import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Profile</h1>
      <div className="bg-white rounded-lg shadow border border-gray-100 p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center text-2xl font-bold text-primary-600">
            {user?.name?.charAt(0) ?? 'U'}
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{user?.name ?? 'User'}</h2>
            <p className="text-gray-500">{user?.email ?? user?.phone ?? '—'}</p>
          </div>
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="text-sm text-gray-500">User ID</dt>
            <dd className="font-medium">{user?.id ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Phone</dt>
            <dd className="font-medium">{user?.phone ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
