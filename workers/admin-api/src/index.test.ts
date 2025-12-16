/**
 * Admin API Worker Tests
 *
 * Basic tests for health check endpoints.
 * Full admin functionality tests will be added in P1-ADMIN-001 Phase 2.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Admin API Worker', () => {
  describe('Health Checks', () => {
    it('should return ok status on root endpoint', async () => {
      const response = await SELF.fetch('http://localhost/');
      expect(response.status).toBe(200);

      const json = (await response.json()) as {
        status: string;
        service: string;
      };
      expect(json.status).toBe('ok');
      expect(json.service).toBe('admin-api');
    });

    it('should return health check status', async () => {
      const response = await SELF.fetch('http://localhost/health');
      // Health check may return 200 or 503 depending on database availability
      expect([200, 503]).toContain(response.status);

      const json = (await response.json()) as {
        status: string;
        service: string;
      };
      expect(json.service).toBe('admin-api');
      expect(['healthy', 'unhealthy']).toContain(json.status);
    });
  });

  describe('Admin Routes Authentication', () => {
    it('should return 401 for unauthenticated admin requests', async () => {
      const response = await SELF.fetch('http://localhost/api/admin/status');
      expect(response.status).toBe(401);

      const json = (await response.json()) as { error: { code: string } };
      expect(json.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Not Found Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await SELF.fetch('http://localhost/unknown-route');
      expect(response.status).toBe(404);
    });
  });
});
