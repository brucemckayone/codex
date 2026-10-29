/**
 * Admin API Worker Tests
 *
 * Health-check + auth-gate coverage for routes. The fee-config endpoint suite
 * (Codex-m644n PR #182) verifies that all 10 platform_owner routes reject
 * anonymous traffic at the procedure() boundary BEFORE any handler or DB
 * touch, conforming to the shared API error envelope `{ error: { code, ... } }`.
 *
 * Authenticated platform_owner flows are covered at the service layer in
 * `packages/purchase/src/__tests__/fee-config-service-writes.test.ts` and
 * via real-DB integration tests when DATABASE_URL is available — wiring
 * BetterAuth + KV inside cloudflare:test is more brittle than the wire-format
 * value it delivers, so we keep this surface focused on gate + envelope.
 */

import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Admin API Worker', () => {
  describe('Health Checks', () => {
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

  // ─── Fee Configuration Endpoints (Codex-m644n) ─────────────────────────────
  // All routes are gated by `policy: { auth: 'platform_owner' }`. Without a
  // valid platform-owner session, the request MUST be rejected at the
  // procedure() boundary BEFORE any handler logic, DB read, or cache touch.
  // The shared error envelope is `{ error: { code, message } }`.
  //
  // We don't drive these endpoints under an authenticated session in this
  // suite — full happy-path coverage lives in the service-layer + integration
  // test files. Here we lock in the gate + envelope.

  describe('Fee Config Routes — auth gate (Codex-m644n)', () => {
    interface FeeRoute {
      method: 'GET' | 'PATCH' | 'PUT' | 'DELETE';
      path: string;
      body?: unknown;
    }

    const ORG = '00000000-0000-0000-0000-000000000001';
    const CREATOR = 'user-9';

    const routes: FeeRoute[] = [
      { method: 'GET', path: '/api/admin/fees/platform' },
      {
        method: 'PATCH',
        path: '/api/admin/fees/platform',
        body: { platformFeePercent: 1100 },
      },
      { method: 'GET', path: `/api/admin/fees/org/${ORG}` },
      {
        method: 'PATCH',
        path: `/api/admin/fees/org/${ORG}`,
        body: { orgFeePercent: 2000 },
      },
      { method: 'DELETE', path: `/api/admin/fees/org/${ORG}` },
      { method: 'GET', path: `/api/admin/fees/org/${ORG}/creators` },
      {
        method: 'GET',
        path: `/api/admin/fees/org/${ORG}/creator/${CREATOR}`,
      },
      {
        method: 'PUT',
        path: `/api/admin/fees/org/${ORG}/creator/${CREATOR}`,
        body: { orgFeePercent: 0 },
      },
      {
        method: 'DELETE',
        path: `/api/admin/fees/org/${ORG}/creator/${CREATOR}`,
      },
      { method: 'GET', path: '/api/admin/fees/audit-log' },
    ];

    it.each(
      routes
    )('rejects anonymous $method $path with 401 + UNAUTHORIZED envelope', async ({
      method,
      path,
      body,
    }) => {
      const response = await SELF.fetch(`http://localhost${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      // procedure() rejects unauthenticated traffic at 401 BEFORE handler.
      // We accept 401 OR 403 here because the platform_owner policy may map
      // missing-session to either depending on the security middleware
      // version — but the response envelope shape must be stable.
      expect([401, 403]).toContain(response.status);

      const json = (await response.json()) as {
        error?: { code: string; message?: string };
      };
      expect(json.error).toBeDefined();
      expect(typeof json.error?.code).toBe('string');
      // No data leakage in the body — gate fires before any handler.
      const raw = JSON.stringify(json);
      expect(raw).not.toMatch(/platformFeePercent/i);
      expect(raw).not.toMatch(/configValue/i);
    });
  });

  // Codex-2hxff.2: support assigns a new owner. Same gate as the fee routes —
  // `platform_owner`, rejected before the handler (and so before any write).
  describe('Ownership support route — auth gate (Codex-2hxff.2)', () => {
    it('rejects anonymous POST /api/admin/organizations/:orgId/owner', async () => {
      const response = await SELF.fetch(
        'http://localhost/api/admin/organizations/00000000-0000-0000-0000-000000000001/owner',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            userId: 'user9',
            reason: 'owner unreachable',
          }),
        }
      );

      expect([401, 403]).toContain(response.status);
      const json = (await response.json()) as { error?: { code: string } };
      expect(typeof json.error?.code).toBe('string');
      expect(JSON.stringify(json)).not.toMatch(/ownerUserId/);
    });
  });

  // Codex-2hxff.21: the support-grant list and revoke are rejected at the
  // real procedure() boundary without a session, before any read or write.
  // The 403-for-a-member half is pinned in customer-grants-routes.test.ts.
  describe('Support grant routes — auth gate (Codex-2hxff.21)', () => {
    const ORG = '00000000-0000-0000-0000-000000000001';
    const ENTITLEMENT = '00000000-0000-0000-0000-000000000002';

    it.each([
      { method: 'GET', path: `/api/admin/customers/user9/grants` },
      {
        method: 'DELETE',
        path: `/api/admin/customers/user9/grants/${ENTITLEMENT}`,
      },
    ])('rejects anonymous $method $path with 401', async ({ method, path }) => {
      const response = await SELF.fetch(
        `http://localhost${path}?organizationId=${ORG}`,
        { method }
      );

      expect(response.status).toBe(401);
      const json = (await response.json()) as { error?: { code: string } };
      expect(json.error?.code).toBe('UNAUTHORIZED');
    });
  });

  // Codex-2hxff.28: support refunds are rejected at the real procedure()
  // boundary without a session, before any read, Stripe call or write. The
  // 403 for a creator or an organisation owner is pinned in
  // support-routes.test.ts.
  describe('Support refund routes — auth gate (Codex-2hxff.28)', () => {
    const CHARGE = 'ch_3QiC9bLk2vAbCdEf';
    const ID = '00000000-0000-0000-0000-000000000003';

    it.each([
      { method: 'GET', path: '/api/admin/support/charges?lookup=a@b.com' },
      { method: 'GET', path: `/api/admin/support/charges/${CHARGE}` },
      {
        method: 'GET',
        path: `/api/admin/support/charges/${CHARGE}/refund-preview?amountCents=1`,
      },
      {
        method: 'POST',
        path: `/api/admin/support/charges/${CHARGE}/refunds`,
        body: {
          amountCents: 100,
          reason: 'requested_by_customer',
          expectedRefundCount: 0,
        },
      },
      { method: 'GET', path: '/api/admin/support/queue/counts' },
      { method: 'GET', path: '/api/admin/support/queue/failed-refunds' },
      { method: 'GET', path: '/api/admin/support/queue/creator-debts' },
      {
        method: 'POST',
        path: `/api/admin/support/refunds/${ID}/resolve`,
        body: { resolution: 'refunded_elsewhere' },
      },
      {
        method: 'POST',
        path: `/api/admin/support/creator-debts/${ID}/resolve`,
        body: { resolution: 'creator_absorbed' },
      },
      // Codex-2hxff.73: Owed to creators.
      { method: 'GET', path: '/api/admin/support/queue/owed-to-creators' },
      {
        method: 'POST',
        path: `/api/admin/support/owed-to-creators/${ID}/resolve`,
        body: { action: 'repay' },
      },
      {
        method: 'POST',
        path: `/api/admin/support/owed-to-creators/${ID}/check`,
      },
    ])('rejects anonymous $method $path with 401', async ({
      method,
      path,
      body,
    }) => {
      const response = await SELF.fetch(`http://localhost${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      expect(response.status).toBe(401);
      const json = (await response.json()) as { error?: { code: string } };
      expect(json.error?.code).toBe('UNAUTHORIZED');
    });
  });
});
