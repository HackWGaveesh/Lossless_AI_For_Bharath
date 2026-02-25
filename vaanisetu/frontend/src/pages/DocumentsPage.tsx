import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Common/Button';

export default function DocumentsPage() {
  const { user } = useAuth();
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Document Vault</h1>

      <div
        className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          dragOver ? 'border-primary-600 bg-primary-50' : 'border-gray-300 bg-gray-50'
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
      >
        <p className="text-gray-600 mb-2">📤 Drag & drop documents or click to upload</p>
        <p className="text-sm text-gray-500 mb-4">Supported: JPG, PNG, PDF (max 5MB)</p>
        <Button>Choose File</Button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          { type: 'Aadhaar Card', icon: '🆔', status: 'Verified' },
          { type: 'PAN Card', icon: '💳', status: 'Pending' },
          { type: 'Caste Certificate', icon: '🏛️', status: 'Verified' },
        ].map((doc) => (
          <div
            key={doc.type}
            className="bg-white rounded-lg shadow border border-gray-100 p-6 hover:shadow-lg transition-shadow"
          >
            <div className="text-3xl mb-2">{doc.icon}</div>
            <h3 className="font-semibold text-gray-900">{doc.type}</h3>
            <p className={`text-sm mt-1 ${doc.status === 'Verified' ? 'text-green-600' : 'text-amber-600'}`}>
              {doc.status}
            </p>
            <Button size="sm" variant="outline" className="mt-4">
              View
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
