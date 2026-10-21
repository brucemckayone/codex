/**
 * GET /api/organizations/:id/members/:userId/departure-preview
 * (Codex-2hxff.64) — the route-level half of data-design §6.
 *
 * The counts and their scoping live in `OrganizationService` (covered against
 * Neon in `packages/organization/src/services/__tests__/departure-preview.test.ts`).
 * What only the route can get wrong, and so what this file asserts:
 *
 *   - the policy: the same as DELETE /:userId — an owner or admin of THIS
 *     organisation may see what a removal does; a creator, a non-member and an
 *     anonymous caller may not, and the service never runs for them;
 *   - the envelope: `{ data: { …five counts } }`, nothing else;
 *   - input validation and error mapping reach the wire (400, 404).
 *
 * Harness mirrors `members-cache-invalidation.test.ts`: the REAL `procedure()`
 * and registry run; the service is a spy; CACHE_KV is an in-memory double whose
 * seeded membership entries satisfy the org policy without Neon.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Seams ──────────────────────────────────────────────────────────────────

const orgSpies = { getDeparturePreview: vi.fn() };

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return { ...actual, OrganizationService: vi.fn(() => orgSpies) };
});

// The membership reader falls through to this on a KV miss: `undefined` means
// "not a member".
const dbStub = {
  query: {
    organizationMemberships: { findFirst: vi.fn(async () => undefined) },
    organizations: { findFirst: vi.fn(async () => undefined) },
  },
};

vi.mock('@codex/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/database')>();
  return { ...actual, createDbClient: vi.fn(() => dbStub) };
});

import { MemberNotFoundError } from '@codex/organization';
import { membershipCacheKey } from '@codex/worker-utils';
import members from '../members';

// ─── KV double ──────────────────────────────────────────────────────────────

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG_ID = '5d444444-4444-4444-8444-444444444444';
const OWNER_ID = 'previewowner01';
const ADMIN_ID = 'previewadmin01';
const CREATOR_ID = 'previewcreator1';
const OUTSIDER_ID = 'previewoutsider';
/** The member whose removal is previewed. `userIdSchema` is `[a-zA-Z0-9]+`. */
const TARGET_ID = 'previewtarget01';

const PREVIEW = {
  agreements: 2,
  contentOnSale: 14,
  coursesOnSale: 2,
  courseSubscriptions: 9,
  tierSubscribersAffected: 37,
};

let kv: ReturnType<typeof makeKv>;
let testEnv: typeof env;

function membershipRow(role: string) {
  return JSON.stringify({
    role,
    status: 'active',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
}

/** `callerId: null` mounts no user, so the real session middleware decides. */
function buildApp(callerId: string | null) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  if (callerId) {
    app.use('*', async (c, next) => {
      c.set('user', {
        id: callerId,
        email: `${callerId}@test.com`,
        role: 'creator',
      });
      // A session unique to this file, so the rate-limit buckets are its own.
      c.set('session', {
        id: `sess_departure_preview_${callerId}`,
        userId: callerId,
      });
      await next();
    });
  }
  // Same mount point as `src/index.ts`, so `:id` resolves as in production.
  app.route('/api/organizations/:id/members', members);
  return app;
}

async function preview(
  callerId: string | null,
  targetId = TARGET_ID
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp(callerId).fetch(
    new Request(
      `http://organization-api.test/api/organizations/${ORG_ID}/members/${targetId}/departure-preview`,
      { method: 'GET' }
    ),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  kv = makeKv();
  testEnv = {
    ...env,
    ENVIRONMENT: 'test',
    CACHE_KV: kv,
  } as unknown as typeof env;

  kv.store.set(membershipCacheKey(ORG_ID, OWNER_ID), membershipRow('owner'));
  kv.store.set(membershipCacheKey(ORG_ID, ADMIN_ID), membershipRow('admin'));
  kv.store.set(
    membershipCacheKey(ORG_ID, CREATOR_ID),
    membershipRow('creator')
  );
  orgSpies.getDeparturePreview.mockResolvedValue(PREVIEW);
});

describe('GET /:userId/departure-preview', () => {
  it.each([
    ['owner', OWNER_ID],
    ['admin', ADMIN_ID],
  ])('answers an %s with the counts, in the single-item envelope', async (_role, callerId) => {
    const res = await preview(callerId);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: PREVIEW });
    expect(orgSpies.getDeparturePreview).toHaveBeenCalledWith(
      ORG_ID,
      TARGET_ID
    );
  });

  it.each([
    ['a creator in the organisation', CREATOR_ID],
    ['someone outside it', OUTSIDER_ID],
  ])('refuses %s, without asking the service', async (_who, callerId) => {
    const res = await preview(callerId);

    expect(res.status).toBe(403);
    expect(orgSpies.getDeparturePreview).not.toHaveBeenCalled();
  });

  it('refuses an anonymous caller', async () => {
    const res = await preview(null);

    expect(res.status).toBe(401);
    expect(orgSpies.getDeparturePreview).not.toHaveBeenCalled();
  });

  it('refuses a malformed user id before the service', async () => {
    const res = await preview(OWNER_ID, 'not-a-user-id');

    expect(res.status).toBe(400);
    expect(orgSpies.getDeparturePreview).not.toHaveBeenCalled();
  });

  it('answers 404 for someone who is not a member', async () => {
    orgSpies.getDeparturePreview.mockRejectedValue(
      new MemberNotFoundError(TARGET_ID)
    );

    const res = await preview(OWNER_ID);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
