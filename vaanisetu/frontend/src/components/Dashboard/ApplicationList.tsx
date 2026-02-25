import React from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export interface ApplicationItem {
  application_id: string;
  scheme_id: string;
  status: string;
  created_at: string;
}

interface ApplicationListProps {
  applications: ApplicationItem[];
}

const statusColors: Record<string, string> = {
  submitted: 'bg-blue-100 text-blue-800',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};

export default function ApplicationList({ applications }: ApplicationListProps) {
  if (!applications?.length) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Applications</h2>
        <p className="text-gray-500">No applications yet. Apply for a scheme from the Schemes page.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Recent Applications</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheme</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {applications.map((app) => (
              <tr key={app.application_id} className="hover:bg-gray-50">
                <td className="px-6 py-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <span className="font-medium text-gray-900">{app.scheme_id}</span>
                </td>
                <td className="px-6 py-4">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                      statusColors[app.status] ?? 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {app.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-gray-500">
                  {formatDistanceToNow(new Date(app.created_at), { addSuffix: true })}
                </td>
                <td className="px-6 py-4 text-right">
                  <Link
                    to={`/applications?id=${app.application_id}`}
                    className="text-primary-600 hover:text-primary-700 font-medium text-sm"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
