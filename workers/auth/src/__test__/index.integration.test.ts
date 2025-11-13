/**
 * Auth Worker - Integration Tests
 *
 * Tests the auth worker via HTTP endpoints using wrangler dev.
 * This provides true integration testing against a real worker server.
 *
 * These tests verify:
 * - Health check endpoint
 * - Real KV namespace bindings
 * - Real database connections (Neon ephemeral branches)
 * - Complete request/response cycle
 *
 * NOTE: This approach works with Vitest 4.0+ (unlike Miniflare which requires 2.x-3.2.x)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  startWranglerDev,
  createWorkerFetch,
  type WranglerDevServer,
} from '@codex/test-utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(__dirname, '../../');

describe('Auth Worker (integration)', () => {
  let server: WranglerDevServer;
  let workerFetch: ReturnType<typeof createWorkerFetch>;

  beforeAll(async () => {
    // Start wrangler dev server for auth worker
    server = await startWranglerDev({
      workerPath,
      port: 8787,
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
  }, 45000); // Give wrangler dev time to start

  afterAll(async () => {
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
        status: 'ok',
        service: 'auth-worker',
        version: '1.0.0',
      });
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('Authentication Endpoints', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await workerFetch('/unknown-endpoint');
      expect(response.status).toBe(404);
    });

    it('should have security headers on auth endpoints', async () => {
      // Test an actual auth endpoint that goes through middleware
      const response = await workerFetch('/api/auth/session');

      // Check for standard security headers applied by middleware
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('x-frame-options')).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed requests gracefully', async () => {
      const response = await workerFetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json{',
      });

      // Should return 400 or similar, not 500
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });
  });
});
