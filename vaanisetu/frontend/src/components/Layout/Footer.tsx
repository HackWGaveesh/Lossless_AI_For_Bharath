import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-200 py-4 px-6 text-center text-sm text-gray-500">
      <p>
        © {new Date().getFullYear()} VaaniSetu — Voice Bridge for 900M Indians. AWS AI for Bharat.
      </p>
      <div className="mt-2 flex justify-center gap-4">
        <Link to="/" className="hover:text-primary-600">Home</Link>
        <Link to="/dashboard" className="hover:text-primary-600">Dashboard</Link>
      </div>
    </footer>
  );
}
