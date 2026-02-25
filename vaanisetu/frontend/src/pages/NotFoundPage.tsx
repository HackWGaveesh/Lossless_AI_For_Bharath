import React from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/Common/Button';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">404</h1>
        <p className="text-xl text-gray-600 mt-4">Page not found</p>
        <Link to="/" className="inline-block mt-6">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
