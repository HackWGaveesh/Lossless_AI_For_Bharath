import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3001/api';

describe('VaaniSetu API Integration Tests', () => {
  const testUserId = 'test-user-' + Date.now();

  describe('Schemes API', () => {
    test('GET /schemes returns list of schemes', async () => {
      const response = await axios.get(`${API_URL}/schemes`);
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data.schemes)).toBe(true);
    });

    test('POST /schemes/search returns relevant schemes', async () => {
      const response = await axios.post(`${API_URL}/schemes/search`, {
        userProfile: {
          age: 35,
          gender: 'male',
          occupation: 'farmer',
          annualIncome: 200000,
          casteCategory: 'general',
          state: 'Bihar',
        },
        query: 'farmer loan',
      });
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data.schemes)).toBe(true);
    });
  });

  describe('Documents API', () => {
    test('POST /documents/upload generates presigned URL', async () => {
      const response = await axios.post(`${API_URL}/documents/upload`, {
        userId: testUserId,
        documentType: 'aadhaar',
        fileName: 'aadhaar.jpg',
        contentType: 'image/jpeg',
      });
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.data.uploadUrl).toBeTruthy();
      expect(response.data.data.documentId).toBeTruthy();
    });
  });

  describe('Applications API', () => {
    test('GET /applications returns list', async () => {
      const response = await axios.get(`${API_URL}/applications`, {
        params: { userId: testUserId },
      });
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(Array.isArray(response.data.data.applications)).toBe(true);
    });

    test('POST /applications creates new application', async () => {
      const response = await axios.post(`${API_URL}/applications`, {
        userId: testUserId,
        schemeId: 'SCHEME-001',
        formData: {
          name: 'Test User',
          phone: '9876543210',
          address: 'Test Address',
        },
      });
      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.data.applicationId).toBeTruthy();
    });
  });
});
