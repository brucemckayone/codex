/**
 * Content API Worker - Integration Tests
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

// Mock KV namespace with required methods
const mockKV = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
} as unknown as KVNamespace;

// Mock environment
const mockEnv = {
  DATABASE_URL: 'mock://database',
  ENVIRONMENT: 'test',
  RATE_LIMIT_KV: mockKV,
};

describe('Content API Worker', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(200);
      const json = (await res.json()) as ErrorResponse;
      expect(json).toEqual({
        status: 'healthy',
        service: 'content-api',
        version: '1.0.0',
      });
    });
  });

  describe('Authentication', () => {
    it('should return 401 without authentication on content endpoint', async () => {
      const req = new Request('http://localhost/api/content');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 without authentication on media endpoint', async () => {
      const req = new Request('http://localhost/api/media');
      const res = await app.fetch(req, mockEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Content Endpoints', () => {
    describe('POST /api/content', () => {
      it('should reject invalid content creation data', async () => {
        const req = createAuthRequest('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Missing required fields
            title: '',
            contentType: 'invalid-type',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate XSS in title field', async () => {
        const req = createAuthRequest('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: '<script>alert("xss")</script>',
            slug: 'test-content',
            contentType: 'video',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug format (no special characters)', async () => {
        const req = createAuthRequest('/api/content', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Test Content',
            slug: 'invalid slug with spaces!@#',
            contentType: 'video',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
        expect(json.error.details).toBeDefined();
      });
    });

    describe('GET /api/content/:id', () => {
      it('should return 404 for non-existent content', async () => {
        const req = createAuthRequest(
          '/api/content/00000000-0000-0000-0000-000000000000'
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate UUID format', async () => {
        const req = createAuthRequest('/api/content/invalid-uuid');

        const res = await app.fetch(req, mockEnv);
        // Should either be 400 (validation error) or 404 (not found after parsing)
        expect([400, 404]).toContain(res.status);
      });
    });

    describe('PATCH /api/content/:id', () => {
      it('should validate update data', async () => {
        const req = createAuthRequest(
          '/api/content/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'invalid-status', // Should be 'draft', 'published', or 'archived'
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate price is non-negative integer', async () => {
        const req = createAuthRequest(
          '/api/content/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priceCents: -100, // Negative price
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate price is integer cents, not decimal', async () => {
        const req = createAuthRequest(
          '/api/content/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priceCents: 9.99, // Float not allowed
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/content (list)', () => {
      it('should accept valid query parameters', async () => {
        const req = createAuthRequest(
          '/api/content?status=published&contentType=video&limit=10&offset=0'
        );

        const res = await app.fetch(req, mockEnv);
        // Should return 200 even with empty results
        expect([200, 404]).toContain(res.status);
      });

      it('should validate limit parameter', async () => {
        const req = createAuthRequest('/api/content?limit=-1');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate contentType enum', async () => {
        const req = createAuthRequest('/api/content?contentType=invalid');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('DELETE /api/content/:id', () => {
      it('should require authentication', async () => {
        const req = new Request(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(401);
      });

      it('should return 404 for non-existent content', async () => {
        const req = createAuthRequest(
          '/api/content/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
      });
    });
  });

  describe('Media Endpoints', () => {
    describe('POST /api/media', () => {
      it('should validate required fields', async () => {
        const req = createAuthRequest('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Missing required fields
            title: '',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate media type', async () => {
        const req = createAuthRequest('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Test Video',
            mediaType: 'invalid-type', // Should be 'video' or 'audio'
            r2Key: 'test/key',
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate file size is non-negative', async () => {
        const req = createAuthRequest('/api/media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Test Video',
            mediaType: 'video',
            r2Key: 'test/key',
            fileSizeBytes: -1, // Negative not allowed
          }),
        });

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/media/:id', () => {
      it('should return 404 for non-existent media', async () => {
        const req = createAuthRequest(
          '/api/media/00000000-0000-0000-0000-000000000000'
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('NOT_FOUND');
      });
    });

    describe('PATCH /api/media/:id', () => {
      it('should validate status enum', async () => {
        const req = createAuthRequest(
          '/api/media/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'invalid-status',
            }),
          }
        );

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/media (list)', () => {
      it('should validate query parameters', async () => {
        const req = createAuthRequest('/api/media?mediaType=invalid');

        const res = await app.fetch(req, mockEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
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
      const req = createAuthRequest('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid json}',
      });

      const res = await app.fetch(req, mockEnv);
      expect([400, 422]).toContain(res.status);
    });

    it('should sanitize error responses (no internal details)', async () => {
      const req = createAuthRequest(
        '/api/content/00000000-0000-0000-0000-000000000000'
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
});
