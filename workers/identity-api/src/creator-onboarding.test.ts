/**
 * Creator Onboarding Endpoints - Integration Tests
 *
 * Tests for GET/PATCH /api/user/creator-onboarding.
 * Runs in Cloudflare Workers runtime (workerd) via cloudflare:test.
 *
 * Security: Session authentication required on both routes.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const ONBOARDING_URL = 'http://localhost/api/user/creator-onboarding';

describe('Creator Onboarding Endpoints', () => {
  describe('Authentication', () => {
    it('GET returns 401 without a session cookie', async () => {
      const response = await SELF.fetch(ONBOARDING_URL);
      expect(response.status).toBe(401);
    });

    it('GET returns 401 with an invalid session cookie', async () => {
      const response = await SELF.fetch(ONBOARDING_URL, {
        headers: { Cookie: 'codex-session=invalid-session-token' },
      });
      expect(response.status).toBe(401);
    });

    it('PATCH returns 401 without a session cookie', async () => {
      const response = await SELF.fetch(ONBOARDING_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: 'payouts' }),
      });
      expect(response.status).toBe(401);
    });
  });

  describe('Route Matching', () => {
    it('matches GET /api/user/creator-onboarding (401 without session, never 404)', async () => {
      const response = await SELF.fetch(ONBOARDING_URL);
      expect([401, 500]).toContain(response.status);
    });

    it('matches PATCH /api/user/creator-onboarding (401 without session, never 404)', async () => {
      const response = await SELF.fetch(ONBOARDING_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentStep: 'finish' }),
      });
      expect([401, 500]).toContain(response.status);
    });

    it('returns 404 for an unsupported method (PUT)', async () => {
      const response = await SELF.fetch(ONBOARDING_URL, { method: 'PUT' });
      expect(response.status).toBe(404);
    });
  });
});
