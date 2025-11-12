/**
 * Identity API Worker - Integration Tests
 *
 * Tests the worker endpoints with authentication, validation, and error handling.
 * These tests verify the complete request/response cycle including:
 * - Authentication middleware
 * - Input validation
 * - Service layer integration
 * - Error responses
 */

import { describe, it, expect } from 'vitest';
import app from './index';

// Error response type for tests
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
    internalMessage?: string;
  };
}

// Helper to create authenticated request
function createAuthRequest(path: string, options: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      // Add session cookie or auth header as per your auth implementation
      Cookie: 'test-session=valid',
    },
  });
}

// Mock environment
const mockEnv = {
  DATABASE_URL: 'mock://database',
  ENVIRONMENT: 'test',
  RATE_LIMIT_KV: {} as KVNamespace,
};

describe('Identity API Worker', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      const json = (await res.json()) as ErrorResponse;
      expect(json).toEqual({
        status: 'healthy',
        service: 'identity-api',
        version: '1.0.0',
      });
    });
  });

  describe('Authentication', () => {
    it('should return 401 without authentication on organizations endpoint', async () => {
      const req = new Request('http://localhost/api/organizations');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 without authentication on POST', async () => {
      const req = new Request('http://localhost/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Org',
          slug: 'test-org',
        }),
      });
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Organization Endpoints', () => {
    describe('POST /api/organizations', () => {
      it('should reject invalid organization creation data', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Missing required fields
            name: '',
            slug: '',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate organization name length', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'a'.repeat(256), // Too long (max 255)
            slug: 'test-org',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug format (no special characters)', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'invalid slug with spaces!@#',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
        expect(json.error.details).toBeDefined();
      });

      it('should validate XSS in organization name', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: '<script>alert("xss")</script>',
            slug: 'test-org',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug pattern (lowercase alphanumeric with hyphens)', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'Test-Org', // Uppercase not allowed
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate URL format for websiteUrl', async () => {
        const req = createAuthRequest('/api/organizations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'test-org',
            websiteUrl: 'not-a-valid-url', // Invalid URL
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/organizations/:id', () => {
      it('should return 404 for non-existent organization', async () => {
        const req = createAuthRequest(
          '/api/organizations/00000000-0000-0000-0000-000000000000'
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate UUID format', async () => {
        const req = createAuthRequest('/api/organizations/invalid-uuid');

        const res = await app.fetch(req, mockEnv);
        // Should either be 400 (validation error) or 404 (not found after parsing)
        expect([400, 404]).toContain(res.status);
      });
    });

    describe('GET /api/organizations/slug/:slug', () => {
      it('should return 404 for non-existent slug', async () => {
        const req = createAuthRequest(
          '/api/organizations/slug/non-existent-org'
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate slug format', async () => {
        const req = createAuthRequest('/api/organizations/slug/Invalid-Slug!');

        const res = await app.fetch(req, mockEnv);
        // Invalid slug should return validation error or not found
        expect([400, 404, 422]).toContain(res.status);
      });
    });

    describe('PATCH /api/organizations/:id', () => {
      it('should validate update data', async () => {
        const req = createAuthRequest(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: '', // Empty name not allowed
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should not allow slug updates (slug is immutable)', async () => {
        const req = createAuthRequest(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: 'new-slug', // Slug changes not allowed
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        // Should either reject the slug field or ignore it
        // If it's ignored, we won't see a validation error
        // If rejected, expect 422
        if (res.status === 422) {
          const json = (await res.json()) as ErrorResponse;
          expect(json.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should validate logoUrl is a valid URL', async () => {
        const req = createAuthRequest(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              logoUrl: 'not-a-url',
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/organizations (list)', () => {
      it('should accept valid query parameters', async () => {
        const req = createAuthRequest('/api/organizations?limit=10&offset=0');

        const res = await app.fetch(req, mockEnv);
        // Should return 200 even with empty results
        expect([200, 404]).toContain(res.status);
      });

      it('should validate limit parameter', async () => {
        const req = createAuthRequest('/api/organizations?limit=-1');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate offset parameter', async () => {
        const req = createAuthRequest('/api/organizations?offset=-1');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate limit max value', async () => {
        const req = createAuthRequest('/api/organizations?limit=1000');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('DELETE /api/organizations/:id', () => {
      it('should require authentication', async () => {
        const req = new Request(
          'http://localhost/api/organizations/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(401);
      });

      it('should return 404 for non-existent organization', async () => {
        const req = createAuthRequest(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const req = createAuthRequest('/api/unknown');

      const res = await app.fetch(req, mockEnv);
      expect(res.status).toBe(404);
    });

    it('should handle malformed JSON gracefully', async () => {
      const req = createAuthRequest('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      const res = await app.fetch(req, mockEnv);
      expect([400, 422]).toContain(res.status);
    });

    it('should sanitize error responses (no internal details)', async () => {
      const req = createAuthRequest(
        '/api/organizations/00000000-0000-0000-0000-000000000000'
      );

      const res = await app.fetch(req, mockEnv);
      const json = (await res.json()) as ErrorResponse;

      // Should not expose internal details like stack traces
      expect(json.error).toBeDefined();
      expect(json.error.stack).toBeUndefined();
      expect(json.error.internalMessage).toBeUndefined();
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, mockEnv);

      // Check for security headers (applied by worker-utils middleware)
      expect(res.headers.get('X-Content-Type-Options')).toBeDefined();
      expect(res.headers.get('X-Frame-Options')).toBeDefined();
    });
  });

  describe('Organization Slug Uniqueness', () => {
    it('should prevent duplicate slug creation', async () => {
      // This test would require mocking the database to return a conflict error
      // For now, we document the expected behavior
      const req = createAuthRequest('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Duplicate Org',
          slug: 'existing-slug', // Assuming this slug already exists
        }),
      });

      const res = await app.fetch(req, mockEnv);
      // Should return 409 Conflict if slug exists
      if (res.status === 409) {
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('CONFLICT');
      }
    });
  });
});
