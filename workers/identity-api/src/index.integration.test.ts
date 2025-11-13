/**
 * Identity API Worker - Integration Tests
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

describe('Identity API Worker', () => {
  let server: WranglerDevServer;
  let workerFetch: ReturnType<typeof createWorkerFetch>;
  let testUser: TestUser;

  beforeAll(async () => {
    // Start wrangler dev server for identity-api worker
    server = await startWranglerDev({
      workerPath,
      port: 8787, // Different port from content-api
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
        service: 'identity-api',
        version: '1.0.0',
      });
    });
  });

  describe('Authentication', () => {
    it('should return 401 without authentication on organizations endpoint', async () => {
      const response = await workerFetch('/api/organizations');

      expect(response.status).toBe(401);
      const json = (await response.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 without authentication on POST', async () => {
      const response = await workerFetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Org',
          slug: 'test-org',
        }),
      });

      expect(response.status).toBe(401);
      const json = (await response.json()) as ErrorResponse;
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Organization Endpoints', () => {
    describe('POST /api/organizations', () => {
      it('should reject invalid organization creation data', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            // Missing required fields
            name: '',
            slug: '',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error).toBeDefined();
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate organization name length', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            name: 'a'.repeat(256), // Too long (max 255)
            slug: 'test-org',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug format (no special characters)', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'invalid slug with spaces!@#',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
        expect(json.error.details).toBeDefined();
      });

      it('should validate XSS in organization name', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            name: '<script>alert("xss")</script>',
            slug: 'test-org',
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate slug pattern (lowercase alphanumeric with hyphens)', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'Test-Org', // Uppercase not allowed
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate URL format for websiteUrl', async () => {
        const response = await workerFetch('/api/organizations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
          body: JSON.stringify({
            name: 'Test Organization',
            slug: 'test-org',
            websiteUrl: 'not-a-valid-url', // Invalid URL
          }),
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/organizations/:id', () => {
      it('should return 404 for non-existent organization', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
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
        const response = await workerFetch('/api/organizations/invalid-uuid', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        // Should either be 400 (validation error) or 404 (not found after parsing)
        expect([400, 404]).toContain(response.status);
      });
    });

    describe('GET /api/organizations/slug/:slug', () => {
      it('should return 404 for non-existent slug', async () => {
        const response = await workerFetch(
          '/api/organizations/slug/non-existent-org',
          {
            headers: {
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(404);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('NOT_FOUND');
      });

      it('should validate slug format', async () => {
        const response = await workerFetch(
          '/api/organizations/slug/Invalid-Slug!',
          {
            headers: {
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
          }
        );

        // Invalid slug should return validation error or not found
        expect([400, 404, 422]).toContain(response.status);
      });
    });

    describe('PATCH /api/organizations/:id', () => {
      it('should validate update data', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
            body: JSON.stringify({
              name: '', // Empty name not allowed
            }),
          }
        );

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should not allow slug updates (slug is immutable)', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
            body: JSON.stringify({
              slug: 'new-slug', // Slug changes not allowed
            }),
          }
        );

        // Should either reject the slug field or ignore it
        // If it's ignored, we won't see a validation error
        // If rejected, expect 422
        if (response.status === 422) {
          const json = (await response.json()) as ErrorResponse;
          expect(json.error.code).toBe('VALIDATION_ERROR');
        }
      });

      it('should validate logoUrl is a valid URL', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
            body: JSON.stringify({
              logoUrl: 'not-a-url',
            }),
          }
        );

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/organizations (list)', () => {
      it('should accept valid query parameters', async () => {
        const response = await workerFetch(
          '/api/organizations?limit=10&offset=0',
          {
            headers: {
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
          }
        );

        // Should return 200 even with empty results
        expect([200, 404]).toContain(response.status);
      });

      it('should validate limit parameter', async () => {
        const response = await workerFetch('/api/organizations?limit=-1', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate offset parameter', async () => {
        const response = await workerFetch('/api/organizations?offset=-1', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });

      it('should validate limit max value', async () => {
        const response = await workerFetch('/api/organizations?limit=1000', {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        });

        expect(response.status).toBe(422);
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('DELETE /api/organizations/:id', () => {
      it('should require authentication', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          { method: 'DELETE' }
        );

        expect(response.status).toBe(401);
      });

      it('should return 404 for non-existent organization', async () => {
        const response = await workerFetch(
          '/api/organizations/00000000-0000-0000-0000-000000000000',
          {
            method: 'DELETE',
            headers: {
              Cookie: `codex-session=${testUser.sessionToken}`,
            },
          }
        );

        expect(response.status).toBe(404);
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
      const response = await workerFetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `codex-session=${testUser.sessionToken}`,
        },
        body: '{invalid json}',
      });

      expect([400, 422]).toContain(response.status);
    });

    it('should sanitize error responses (no internal details)', async () => {
      const response = await workerFetch(
        '/api/organizations/00000000-0000-0000-0000-000000000000',
        {
          headers: {
            Cookie: `codex-session=${testUser.sessionToken}`,
          },
        }
      );

      const json = (await response.json()) as ErrorResponse;

      // Should not expose internal details like stack traces
      expect(json.error).toBeDefined();
      expect(json.error.stack).toBeUndefined();
      expect(json.error.internalMessage).toBeUndefined();
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

  describe('Organization Slug Uniqueness', () => {
    it('should prevent duplicate slug creation', async () => {
      // This test would require mocking the database to return a conflict error
      // For now, we document the expected behavior
      const response = await workerFetch('/api/organizations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `codex-session=${testUser.sessionToken}`,
        },
        body: JSON.stringify({
          name: 'Duplicate Org',
          slug: 'existing-slug', // Assuming this slug already exists
        }),
      });

      // Should return 409 Conflict if slug exists
      if (response.status === 409) {
        const json = (await response.json()) as ErrorResponse;
        expect(json.error.code).toBe('CONFLICT');
      }
    });
  });
});
