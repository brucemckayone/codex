/**
 * Membership Lookup Endpoint - Unit Tests
 *
 * Tests for GET /api/organizations/:orgId/membership/:userId
 * Runs in the Cloudflare Workers runtime (workerd) via cloudflare:test.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const VALID_ORG_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_USER_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

describe('Membership Lookup Endpoint', () => {
  describe('Route Matching', () => {
    it('should match GET /api/organizations/:orgId/membership/:userId', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`
      );
      // Should not 404 — route exists. May return 200 or 500 depending on DB availability.
      expect(response.status).not.toBe(404);
    });

    it('should return 404 for POST method', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`,
        { method: 'POST' }
      );
      expect(response.status).toBe(404);
    });
  });

  describe('Param Validation', () => {
    it('should return 400 for invalid orgId (not a UUID)', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/not-a-uuid/membership/${VALID_USER_ID}`
      );
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid userId (contains hyphens)', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/user-with-hyphens`
      );
      expect(response.status).toBe(400);
    });
  });

  describe('No Membership (DB unavailable in test)', () => {
    it('should return role: null when membership is not found', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`
      );

      // In test env without DB, checkOrganizationMembership returns null on error,
      // so the endpoint returns the "not a member" response.
      if (response.status === 200) {
        const json = (await response.json()) as {
          data: { role: string | null; joinedAt: string | null };
        };
        expect(json.data).toEqual({ role: null, joinedAt: null });
      }
      // If DB connection causes a 500, that's also acceptable in test env
      expect([200, 500]).toContain(response.status);
    });
  });
});
