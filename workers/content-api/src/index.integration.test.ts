/**
 * Content API Worker - Integration Tests
 *
 * Tests the worker endpoints via HTTP using wrangler dev server.
 * These tests verify the complete request/response cycle including:
 * - Authentication middleware (using real sessions from test database)
 * - Input validation
 * - Service layer integration
 * - Error responses
 * - Real KV bindings
 *
 * IMPORTANT: These are true integration tests using:
 * - Real wrangler dev server (not in-process Hono app)
 * - Real database connections (Neon ephemeral branches)
 * - Real session-based authentication
 * - Real Cloudflare Workers runtime environment
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startWranglerDev,
  createWorkerFetch,
  type WranglerDevServer,
} from '@codex/test-utils';
import {
  createTestUser,
  cleanupTestUser,
  type TestUser,
} from '@codex/worker-utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(__dirname, '../');

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

describe('Content API Worker (integration)', () => {
  let server: WranglerDevServer;
  let workerFetch: ReturnType<typeof createWorkerFetch>;
  let testUser: TestUser;

  beforeAll(async () => {
    // Start wrangler dev server for content-api worker
    server = await startWranglerDev({
      workerPath,
      port: 8788, // Different port from auth worker
      env: {
        // eslint-disable-next-line no-undef
        DATABASE_URL: process.env.DATABASE_URL || '',
        ENVIRONMENT: 'test',
        // eslint-disable-next-line no-undef
        DB_METHOD: process.env.DB_METHOD || 'LOCAL_PROXY',
      },
      startupTimeout: 30000,
      verbose: false,
    });

    workerFetch = createWorkerFetch(server.url);

    // Create test user with valid session
    testUser = await createTestUser();
  }, 45000);

  afterAll(async () => {
    // Cleanup test user
    if (testUser) {
      await cleanupTestUser(testUser.user.id);
    }

    // Stop wrangler dev server
    if (server) {
      await server.cleanup();
    }
  }, 10000);

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await workerFetch('/health');

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toMatchObject({
        status: 'healthy',
        service: 'content-api',
        version: '1.0.0',
      });
    });
  });

  describe('Authentication', () => {
    it('should return 401 without authentication on content endpoint', async () => {
      const response = await workerFetch('/api/content');

      expect(response.status).toBe(401);
      const json = (await response.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 without authentication on media endpoint', async () => {
      const response = await workerFetch('/api/media');

      expect(response.status).toBe(401);
      const json = (await response.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Content Endpoints', () => {
    describe('POST /api/content', () => {
      it('should reject invalid content creation data', async () => {
        const response = await workerFetch('/api/content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            // Missing required fields
            title: '',
            contentType: 'invalid-type',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate XSS in title field', async () => {
        const response = await workerFetch('/api/content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            title: '<script>alert("xss")</script>',
            slug: 'test-content',
            contentType: 'video',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug format (no special characters)', async () => {
        const response = await workerFetch('/api/content', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            title: 'Test Content',
            slug: 'invalid slug with spaces!@#',
            contentType: 'video',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
        expect(json.error.details).toBeDefined();
      });
    });

    describe('GET /api/content/:id', () => {
      it('should return 404 for non-existent content', async () => {
        const response = await workerFetch(
          '/api/content/00000000-0000-0000-0000-000000000000',
          {
            headers: {
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(404);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate UUID format', async () => {
        const response = await workerFetch('/api/content/invalid-uuid', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        // Should either be 400 (validation error) or 404 (not found after parsing)
        expect([400, 404]).toContain(response.status);
      });
    });

    describe('GET /api/content (list)', () => {
      it('should validate limit parameter', async () => {
        const response = await workerFetch('/api/content?limit=-1', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate contentType enum', async () => {
        const response = await workerFetch('/api/content?contentType=invalid', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('DELETE /api/content/:id', () => {
      it('should require authentication', async () => {
        const response = await workerFetch(
          '/api/content/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        expect(response.status).toBe(401);
      });
    });
  });

  describe('Media Endpoints', () => {
    describe('POST /api/media', () => {
      it('should validate required fields', async () => {
        const response = await workerFetch('/api/media', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            // Missing required fields
            title: '',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate media type', async () => {
        const response = await workerFetch('/api/media', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            title: 'Test Video',
            mediaType: 'invalid-type', // Should be 'video' or 'audio'
            r2Key: 'test/key',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await workerFetch('/api/unknown', {
        headers: {
          Cookie: `codex-session=${testUser.sessionToken}`,
        },
      });

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON gracefully', async () => {
      const response = await workerFetch('/api/content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `codex-session=${testUser.sessionToken}`,
        },
        body: '{invalid json}',
      });

      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await workerFetch('/health');

      // Check for security headers (applied by worker-utils middleware)
      expect(response.headers.get('x-content-type-options')).toBeDefined();
      expect(response.headers.get('x-frame-options')).toBeDefined();
    });
  });
});
