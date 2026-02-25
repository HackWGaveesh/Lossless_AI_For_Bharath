import React from 'react';
import { CheckCircle, Clock, Upload } from 'lucide-react';

const activities = [
  { icon: CheckCircle, text: 'PM-KISAN application approved', time: '2 days ago', color: 'text-green-600' },
  { icon: Upload, text: 'Income certificate uploaded', time: '3 days ago', color: 'text-blue-600' },
  { icon: Clock, text: 'MUDRA loan under review', time: '5 days ago', color: 'text-amber-600' },
];

export default function RecentActivity() {
  return (
    <div className="bg-white rounded-lg shadow border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
      <ul className="space-y-4">
        {activities.map((item, i) => (
          <li key={i} className="flex gap-3">
            <div className={`shrink-0 ${item.color}`}>
              <item.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">{item.text}</p>
              <p className="text-xs text-gray-500">{item.time}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
