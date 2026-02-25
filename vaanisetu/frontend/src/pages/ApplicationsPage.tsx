import React from 'react';
import { useQuery } from 'react-query';
import { fetchApplications } from '../services/api';
import ApplicationList from '../components/Dashboard/ApplicationList';
import Spinner from '../components/Common/Spinner';

export default function ApplicationsPage() {
  const { data: applications, isLoading } = useQuery('applications', fetchApplications);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Application Tracker</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Status Timeline</h2>
        <ul className="space-y-4">
          <li className="flex gap-3">
            <span className="text-green-600 font-bold">✓</span>
            <div>
              <p className="font-medium">Application Submitted</p>
              <p className="text-sm text-gray-500">5 Feb 2024</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-amber-600 font-bold">⟳</span>
            <div>
              <p className="font-medium">Document Verification (In Progress)</p>
              <p className="text-sm text-gray-500">Upload pending: Income certificate</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-gray-400">○</span>
            <div>
              <p className="font-medium text-gray-500">Field Verification (Pending)</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="text-gray-400">○</span>
            <div>
              <p className="font-medium text-gray-500">Approval (Pending)</p>
            </div>
          </li>
        </ul>
      </div>
      {isLoading ? (
        <Spinner />
      ) : (
        <ApplicationList applications={applications ?? []} />
      )}
    </div>
  );
}
