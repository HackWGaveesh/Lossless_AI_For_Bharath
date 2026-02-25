import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export interface Scheme {
  schemeId: string;
  nameEn?: string;
  nameHi?: string;
  description?: string;
  benefitAmountMin?: number;
  benefitAmountMax?: number;
  eligibilityCriteria?: Record<string, unknown>;
}

export interface SchemesResponse {
  success: boolean;
  data: { schemes: Scheme[]; total: number };
}

export interface ApplicationItem {
  application_id: string;
  scheme_id: string;
  status: string;
  created_at: string;
}

export async function fetchSchemes(params?: { category?: string; benefitType?: string; limit?: number; offset?: number }) {
  const { data } = await api.get<SchemesResponse>('/schemes', { params });
  return data;
}

export async function searchSchemes(userProfile: Record<string, unknown>, query: string) {
  const { data } = await api.post<{ success: boolean; data: { schemes: Scheme[]; agentInsights?: string } }>(
    '/schemes/search',
    { userProfile, query }
  );
  return data;
}

export async function fetchUserStats() {
  return {
    activeApplications: 3,
    pendingApplications: 2,
    approvedApplications: 1,
    jobMatches: 5,
  };
}

export async function fetchApplications(userId?: string): Promise<ApplicationItem[]> {
  try {
    const { data } = await api.get<{ success: boolean; data: { applications?: ApplicationItem[] } }>('/applications', {
      params: userId ? { userId } : {},
    });
    return data.data?.applications ?? [];
  } catch {
    return [
      { application_id: 'APP-1', scheme_id: 'MUDRA-SHISHU', status: 'pending', created_at: new Date().toISOString() },
      { application_id: 'APP-2', scheme_id: 'PM-KISAN', status: 'approved', created_at: new Date().toISOString() },
    ];
  }
}

export async function requestDocumentUpload(body: {
  userId: string;
  documentType: string;
  fileName: string;
  contentType?: string;
}) {
  const { data } = await api.post<{ success: boolean; data: { documentId: string; uploadUrl: string; key: string; expiresIn: number } }>(
    '/documents/upload',
    body
  );
  return data;
}

export async function createApplication(body: { userId: string; schemeId: string; formData?: Record<string, unknown> }) {
  const { data } = await api.post<{ success: boolean; data: { applicationId: string; status: string } }>(
    '/applications',
    body
  );
  return data;
}
