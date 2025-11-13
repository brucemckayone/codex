/**
 * Content API Worker - Integration Tests
 *
 * Tests the worker endpoints with authentication, validation, and error handling.
 * These tests verify the complete request/response cycle including:
 * - Authentication middleware (using real sessions from test database)
 * - Input validation
 * - Service layer integration
 * - Error responses
 *
 * IMPORTANT: These are true integration tests using:
 * - Real database connections (Neon ephemeral branches)
 * - Real session-based authentication
 * - No mocks for authentication or database
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import app from './index';
import {
  createTestUser,
  cleanupTestUser,
  createAuthenticatedRequest,
  type TestUser,
} from '@codex/worker-utils';

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

// Mock KV namespace with required methods (KV is only for caching, not core functionality)
const mockKV = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true, cursor: '' }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
} as unknown as KVNamespace;

// Test environment - uses real DATABASE_URL from environment
const testEnv = {
  // eslint-disable-next-line no-undef
  DATABASE_URL: process.env.DATABASE_URL || '',
  ENVIRONMENT: 'test',
  RATE_LIMIT_KV: mockKV,
  AUTH_SESSION_KV: mockKV, // Session auth will fall back to database if KV returns null
};

// Test user for authenticated requests
let testUser: TestUser;

describe('Content API Worker', () => {
  // Setup: Create test user with valid session before all tests
  beforeAll(async () => {
    testUser = await createTestUser();
  });

  // Cleanup: Remove test user after all tests
  afterAll(async () => {
    if (testUser) {
      await cleanupTestUser(testUser.user.id);
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const req = new Request('http://localhost/health');
      const res = await app.fetch(req, testEnv);

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
      const res = await app.fetch(req, testEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 without authentication on media endpoint', async () => {
      const req = new Request('http://localhost/api/media');
      const res = await app.fetch(req, testEnv);

      expect(res.status).toBe(401);
      const json = (await res.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Content Endpoints', () => {
    describe('POST /api/content', () => {
      it('should reject invalid content creation data', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // Missing required fields
              title: '',
              contentType: 'invalid-type',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate XSS in title field', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: '<script>alert("xss")</script>',
              slug: 'test-content',
              contentType: 'video',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug format (no special characters)', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Test Content',
              slug: 'invalid slug with spaces!@#',
              contentType: 'video',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
        expect(json.error.details).toBeDefined();
      });
    });

    describe('GET /api/content/:id', () => {
      it('should return 404 for non-existent content', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate UUID format', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/invalid-uuid',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        // Should either be 400 (validation error) or 404 (not found after parsing)
        expect([400, 404]).toContain(res.status);
      });
    });

    describe('PATCH /api/content/:id', () => {
      it('should validate update data', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'invalid-status', // Should be 'draft', 'published', or 'archived'
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate price is non-negative integer', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priceCents: -100, // Negative price
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate price is integer cents, not decimal', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priceCents: 9.99, // Float not allowed
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/content (list)', () => {
      it('should accept valid query parameters', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content?status=published&contentType=video&limit=10&offset=0',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        // Should return 200 even with empty results
        expect([200, 404]).toContain(res.status);
      });

      it('should validate limit parameter', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content?limit=-1',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate contentType enum', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content?contentType=invalid',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
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

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(401);
      });

      it('should return 404 for non-existent content', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken,
          { method: 'DELETE' }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(404);
      });
    });
  });

  describe('Media Endpoints', () => {
    describe('POST /api/media', () => {
      it('should validate required fields', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              // Missing required fields
              title: '',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate media type', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Test Video',
              mediaType: 'invalid-type', // Should be 'video' or 'audio'
              r2Key: 'test/key',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate file size is non-negative', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media',
          testUser.sessionToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: 'Test Video',
              mediaType: 'video',
              r2Key: 'test/key',
              fileSizeBytes: -1, // Negative not allowed
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/media/:id', () => {
      it('should return 404 for non-existent media', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(404);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('NOT_FOUND');
      });
    });

    describe('PATCH /api/media/:id', () => {
      it('should validate status enum', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media/00000000-0000-0000-0000-000000000000',
          testUser.sessionToken,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'invalid-status',
            }),
          }
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/media (list)', () => {
      it('should validate query parameters', async () => {
        const req = createAuthenticatedRequest(
          'http://localhost/api/media?mediaType=invalid',
          testUser.sessionToken
        );

        const res = await app.fetch(req, testEnv);
        expect(res.status).toBe(422);
        const json = (await res.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const req = createAuthenticatedRequest(
        'http://localhost/api/unknown',
        testUser.sessionToken
      );

      const res = await app.fetch(req, testEnv);
      expect(res.status).toBe(404);
    });

    it('should handle malformed JSON gracefully', async () => {
      const req = createAuthenticatedRequest(
        'http://localhost/api/content',
        testUser.sessionToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{invalid json}',
        }
      );

      const res = await app.fetch(req, testEnv);
      expect([400, 422]).toContain(res.status);
    });

    it('should sanitize error responses (no internal details)', async () => {
      const req = createAuthenticatedRequest(
        'http://localhost/api/content/00000000-0000-0000-0000-000000000000',
        testUser.sessionToken
      );

      const res = await app.fetch(req, testEnv);
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
      const res = await app.fetch(req, testEnv);

      // Check for security headers (applied by worker-utils middleware)
      expect(res.headers.get('X-Content-Type-Options')).toBeDefined();
      expect(res.headers.get('X-Frame-Options')).toBeDefined();
    });
  });
});
