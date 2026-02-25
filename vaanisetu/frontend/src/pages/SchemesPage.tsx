import React, { useState } from 'react';
import { useQuery } from 'react-query';
import { fetchSchemes, type Scheme } from '../services/api';
import Button from '../components/Common/Button';
import Spinner from '../components/Common/Spinner';

export default function SchemesPage() {
  const [category, setCategory] = useState<string>('');

  const { data, isLoading } = useQuery(['schemes', category], () =>
    fetchSchemes({ category: category || undefined, limit: 50 })
  );

  const schemes: Scheme[] = data?.data?.schemes ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Government Schemes</h1>
      <div className="flex gap-4 flex-wrap">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-gray-300 px-4 py-2"
        >
          <option value="">All categories</option>
          <option value="agriculture">Agriculture</option>
          <option value="financial_inclusion">Financial Inclusion</option>
        </select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : schemes.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-gray-500">
          No schemes found. Run seed script to populate data.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schemes.map((scheme) => (
            <div
              key={scheme.schemeId}
              className="bg-white rounded-lg shadow border border-gray-100 p-6 hover:shadow-lg transition-shadow"
            >
              <h3 className="text-lg font-semibold text-gray-900">{scheme.nameEn ?? scheme.schemeId}</h3>
              {scheme.nameHi && (
                <p className="text-sm text-gray-600 mt-1">{scheme.nameHi}</p>
              )}
              <p className="text-gray-600 mt-2 text-sm">{scheme.description}</p>
              {(scheme.benefitAmountMin != null || scheme.benefitAmountMax != null) && (
                <p className="text-primary-600 font-medium mt-2">
                  ₹{scheme.benefitAmountMin ?? 0} - ₹{scheme.benefitAmountMax ?? 0}
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button size="sm">View Details</Button>
                <Button size="sm" variant="outline">Apply Now</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
