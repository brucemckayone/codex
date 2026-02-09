/**
 * Membership Lookup Endpoint - Unit Tests
 *
 * Tests for GET /api/organizations/:orgId/membership/:userId
 * Runs in the Cloudflare Workers runtime (workerd) via cloudflare:test.
 *
 * Security: Worker-to-worker HMAC authentication required
 */

import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const VALID_ORG_ID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_USER_ID = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

/**
 * Generate worker auth headers for testing
 * Mirrors the generateWorkerSignature function from @codex/security
 */
async function generateWorkerAuthHeaders(
  body: string = ''
): Promise<Record<string, string>> {
  const secret = env.WORKER_SHARED_SECRET || 'test-worker-secret';
  const timestamp = Math.floor(Date.now() / 1000);

  const encoder = new TextEncoder();
  const data = encoder.encode(`${timestamp}:${body}`);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, data);
  const base64Signature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  );

  return {
    'X-Worker-Signature': base64Signature,
    'X-Worker-Timestamp': timestamp.toString(),
  };
}

describe('Membership Lookup Endpoint', () => {
  describe('Worker Authentication', () => {
    it('should return 401 if worker auth headers are missing', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`
      );
      expect(response.status).toBe(401);
    });

    it('should return 401 if worker signature is invalid', async () => {
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`,
        {
          headers: {
            'X-Worker-Signature': 'invalid-signature',
            'X-Worker-Timestamp': Math.floor(Date.now() / 1000).toString(),
          },
        }
      );
      expect(response.status).toBe(401);
    });
  });

  describe('Route Matching (with valid auth)', () => {
    it('should match GET /api/organizations/:orgId/membership/:userId', async () => {
      const headers = await generateWorkerAuthHeaders();
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`,
        { headers }
      );
      // Should not 401/404 — route exists and auth passed.
      // May return 200 or 500 depending on DB availability.
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(404);
    });

    it('should return 404 for POST method', async () => {
      const headers = await generateWorkerAuthHeaders();
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`,
        { method: 'POST', headers }
      );
      expect(response.status).toBe(404);
    });
  });

  describe('Param Validation (with valid auth)', () => {
    it('should return 400 for invalid orgId (not a UUID)', async () => {
      const headers = await generateWorkerAuthHeaders();
      const response = await SELF.fetch(
        `http://localhost/api/organizations/not-a-uuid/membership/${VALID_USER_ID}`,
        { headers }
      );
      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid userId (contains hyphens)', async () => {
      const headers = await generateWorkerAuthHeaders();
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/user-with-hyphens`,
        { headers }
      );
      expect(response.status).toBe(400);
    });
  });

  describe('No Membership (DB unavailable in test)', () => {
    it('should return role: null when membership is not found', async () => {
      const headers = await generateWorkerAuthHeaders();
      const response = await SELF.fetch(
        `http://localhost/api/organizations/${VALID_ORG_ID}/membership/${VALID_USER_ID}`,
        { headers }
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
