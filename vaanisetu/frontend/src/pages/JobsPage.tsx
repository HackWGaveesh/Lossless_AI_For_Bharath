import React from 'react';
import Button from '../components/Common/Button';

const sampleJobs = [
  { id: '1', title: 'Farm Supervisor', location: 'Bihar', type: 'Full-time' },
  { id: '2', title: 'MGNREGA Mate', location: 'Tamil Nadu', type: 'Contract' },
  { id: '3', title: 'Rural Health Worker', location: 'Telangana', type: 'Part-time' },
];

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Job Board</h1>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {sampleJobs.map((job) => (
          <div
            key={job.id}
            className="bg-white rounded-lg shadow border border-gray-100 p-6 hover:shadow-lg transition-shadow"
          >
            <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
            <p className="text-gray-600 text-sm mt-1">{job.location}</p>
            <p className="text-gray-500 text-sm">{job.type}</p>
            <Button size="sm" className="mt-4">
              View Details
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
