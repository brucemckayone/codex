/**
 * Ownership routes (Codex-2hxff.2) — the route-level half of data-design §13.
 *
 * The rules live in `OrganizationService` (covered against Neon in
 * `packages/organization/src/services/__tests__/ownership-transfer.test.ts`).
 * What only the route can get wrong, and so what this file asserts:
 *
 *   - ACCEPT changes TWO users' roles, so it must delete BOTH users' membership
 *     cache entries — the exact keys the policy reader reads (a bare `kv.get`
 *     with no version check, so a missed delete keeps the old role for the
 *     entry's TTL: the new owner refused, the old owner still owner).
 *   - GET composes the agreement fields for the owner and the recipient only.
 *   - input validation reaches the wire (400s) before the service.
 *
 * Harness mirrors `members-cache-invalidation.test.ts`: the REAL `procedure()`
 * and registry run; the services are spies; CACHE_KV is an in-memory double
 * that records the keys it was handed.
 */

import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Seams: the registry's services ─────────────────────────────────────────

const orgSpies = {
  getOwnership: vi.fn(),
  offerOwnership: vi.fn(),
  withdrawOwnershipOffer: vi.fn(),
  acceptOwnershipOffer: vi.fn(),
  declineOwnershipOffer: vi.fn(),
};

vi.mock('@codex/organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/organization')>();
  return { ...actual, OrganizationService: vi.fn(() => orgSpies) };
});

// `@codex/agreements` is a devDependency of this worker for exactly this mock:
// without it the specifier resolves to a different module id from the one
// worker-utils imports, the mock never applies, and the real service queries
// the test database.
const agreementSpies = { getActiveAgreementSummaries: vi.fn() };

vi.mock('@codex/agreements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/agreements')>();
  return { ...actual, AgreementService: vi.fn(() => agreementSpies) };
});

// `dispatchOrgSlugInvalidation` builds a client eagerly; the real one throws
// without DATABASE_URL_LOCAL_PROXY.
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

import { membershipCacheKey } from '@codex/worker-utils';
import ownership from '../ownership';

// ─── KV double ──────────────────────────────────────────────────────────────

function makeKv() {
  const store = new Map<string, string>();
  const deletes: string[] = [];
  return {
    store,
    deletes,
    get: vi.fn(async (key: string, type?: string) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      deletes.push(key);
      store.delete(key);
    }),
    list: vi.fn(async () => ({ keys: [], list_complete: true })),
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ORG_ID = '5d333333-3333-4333-8333-333333333333';
const OFFER_ID = '6e444444-4444-4444-8444-444444444444';
const OWNER_ID = 'owneruser0001';
const RECIPIENT_ID = 'recipient0001';
const JOINED_AT = '2026-01-01T00:00:00.000Z';

let kv: ReturnType<typeof makeKv>;
let testEnv: typeof env;

function membershipRow(role: string) {
  return JSON.stringify({ role, status: 'active', joinedAt: JOINED_AT });
}

function buildApp(callerId: string) {
  const app = new Hono<{ Variables: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: callerId,
      email: `${callerId}@test.com`,
      role: 'creator',
    });
    // A session unique to this file, so the rate-limit buckets are its own.
    c.set('session', {
      id: `sess_ownership_routes_${callerId}`,
      userId: callerId,
    });
    await next();
  });
  // Same mount point as `src/index.ts`.
  app.route('/api/organizations/:id/ownership', ownership);
  return app;
}

async function dispatch(
  callerId: string,
  path: string,
  init: RequestInit & { method: string }
): Promise<Response> {
  const ec = createExecutionContext();
  const res = await buildApp(callerId).fetch(
    new Request(`http://organization-api.test${path}`, init),
    testEnv,
    ec
  );
  await waitOnExecutionContext(ec);
  return res;
}

const base = `/api/organizations/${ORG_ID}/ownership`;

const ownerView = {
  owner: {
    userId: OWNER_ID,
    name: 'Alex',
    avatarUrl: null,
    ownerSince: JOINED_AT,
    payoutsReady: true,
  },
  viewerRole: 'owner',
  openOffer: null,
  lastOutcome: null,
  eligibleRecipients: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  kv = makeKv();
  testEnv = {
    ...env,
    ENVIRONMENT: 'test',
    CACHE_KV: kv,
  } as unknown as typeof env;

  // Warm membership entries, so `requireOrgMembership` passes without Neon.
  kv.store.set(membershipCacheKey(ORG_ID, OWNER_ID), membershipRow('owner'));
  kv.store.set(
    membershipCacheKey(ORG_ID, RECIPIENT_ID),
    membershipRow('creator')
  );

  orgSpies.acceptOwnershipOffer.mockResolvedValue({
    ownerUserId: RECIPIENT_ID,
    ownerSince: '2026-10-14T00:00:00.000Z',
    previousOwnerUserId: OWNER_ID,
  });
  agreementSpies.getActiveAgreementSummaries.mockResolvedValue([]);
});

describe('POST /offers/:offerId/accept', () => {
  it("deletes BOTH users' membership cache entries", async () => {
    const res = await dispatch(
      RECIPIENT_ID,
      `${base}/offers/${OFFER_ID}/accept`,
      {
        method: 'POST',
      }
    );

    expect(res.status).toBe(200);
    expect(orgSpies.acceptOwnershipOffer).toHaveBeenCalledWith(
      ORG_ID,
      OFFER_ID,
      RECIPIENT_ID
    );
    expect(kv.deletes.sort()).toEqual(
      [
        membershipCacheKey(ORG_ID, RECIPIENT_ID),
        membershipCacheKey(ORG_ID, OWNER_ID),
      ].sort()
    );
    // The literal format the reader uses, so a drift in both places fails too.
    expect(kv.deletes).toContain(`membership:${ORG_ID}:${OWNER_ID}`);
  });

  // The web client sends `Content-Type: application/json` on every POST, even
  // with no body. These routes declare no `input.body`, so nothing may parse it.
  it('accepts a JSON content type with an empty body', async () => {
    const res = await dispatch(
      RECIPIENT_ID,
      `${base}/offers/${OFFER_ID}/accept`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    );

    expect(res.status).toBe(200);
  });
});

describe('POST /offers', () => {
  it('passes the caller and body to the service and returns 201', async () => {
    orgSpies.offerOwnership.mockResolvedValue({ id: OFFER_ID, status: 'open' });

    const res = await dispatch(OWNER_ID, `${base}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipientUserId: RECIPIENT_ID,
        confirmName: 'Studio Alpha',
      }),
    });

    expect(res.status).toBe(201);
    expect(orgSpies.offerOwnership).toHaveBeenCalledWith(ORG_ID, OWNER_ID, {
      recipientUserId: RECIPIENT_ID,
      confirmName: 'Studio Alpha',
    });
  });

  it('rejects a missing confirmation name with 400, before the service', async () => {
    const res = await dispatch(OWNER_ID, `${base}/offers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientUserId: RECIPIENT_ID }),
    });

    expect(res.status).toBe(400);
    expect(orgSpies.offerOwnership).not.toHaveBeenCalled();
  });
});

describe('GET /', () => {
  it("adds the agreements and the owner's subscription-agreement flag for the owner", async () => {
    orgSpies.getOwnership.mockResolvedValue(ownerView);
    agreementSpies.getActiveAgreementSummaries.mockResolvedValue([
      {
        creatorId: OWNER_ID,
        creatorName: 'Alex',
        revenueType: 'subscription',
        shareBps: 6000,
        since: JOINED_AT,
      },
    ]);

    const res = await dispatch(OWNER_ID, base, { method: 'GET' });
    const body = (await res.json()) as { data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.data.ownerHasSubscriptionAgreement).toBe(true);
    expect(body.data.activeAgreements).toEqual([
      {
        creatorName: 'Alex',
        revenueType: 'subscription',
        shareBps: 6000,
        since: JOINED_AT,
      },
    ]);
  });

  it('leaves the agreements out for an admin with no offer', async () => {
    orgSpies.getOwnership.mockResolvedValue({
      owner: ownerView.owner,
      viewerRole: 'admin',
      openOffer: null,
    });

    const res = await dispatch(RECIPIENT_ID, base, { method: 'GET' });
    const body = (await res.json()) as { data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.data.activeAgreements).toBeUndefined();
    expect(agreementSpies.getActiveAgreementSummaries).not.toHaveBeenCalled();
  });

  it('shows the recipient the agreements but not the owner-only flag', async () => {
    orgSpies.getOwnership.mockResolvedValue({
      owner: ownerView.owner,
      viewerRole: 'creator',
      openOffer: {
        id: OFFER_ID,
        recipient: { userId: RECIPIENT_ID, name: 'Sam' },
        offeredBy: { userId: OWNER_ID, name: 'Alex' },
        offeredAt: JOINED_AT,
        expiresAt: JOINED_AT,
      },
    });

    const res = await dispatch(RECIPIENT_ID, base, { method: 'GET' });
    const body = (await res.json()) as { data: Record<string, unknown> };

    expect(body.data.activeAgreements).toEqual([]);
    expect(body.data.ownerHasSubscriptionAgreement).toBeUndefined();
  });
});
