/**
 * ContentAccessService.getWithdrawnContent: an item withdrawn from sale opens
 * for whoever the access decision still grants, and is the same 404 for
 * everyone else (Codex-ov2ii).
 *
 * Stubbed DB, as content-access-service-followers-subscription.test.ts: the
 * real `decideContentAccess` runs inside the transaction callback against
 * `tx.query.*` mocks. A stub returns whatever row it is given, so the lookup's
 * WHERE (released, not published, not deleted, scoped to the URL's key) is
 * pinned by the DB-backed content-access-withdrawn.integration.test.ts; this
 * file pins what happens to the row the lookup found.
 */

import type { PurchaseService } from '@codex/purchase';
import type { ServiceConfig } from '@codex/service-errors';
import { createMockObservability } from '@codex/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentNotFoundError } from '../../errors';
import type { AccessRevocation } from '../access-revocation';
import { ContentAccessService } from '../ContentAccessService';

type FindFirstFn = ReturnType<typeof vi.fn>;

interface StubDb {
  mocks: {
    content: { findFirst: FindFirstFn };
    organizationMemberships: { findFirst: FindFirstFn };
    organizationFollowers: { findFirst: FindFirstFn };
    subscriptions: { findFirst: FindFirstFn };
    subscriptionTiers: { findFirst: FindFirstFn };
  };
  transaction: ReturnType<typeof vi.fn>;
}

/** Every additive entitlement / course read resolves to no rows. */
function emptySelect() {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable — mimics Drizzle's awaitable query builder so `await db.select()...` resolves to [].
    then: (resolve: (rows: never[]) => unknown) => resolve([]),
  };
  return builder;
}

function createStubDb(): StubDb {
  const mocks = {
    content: { findFirst: vi.fn() },
    organizationMemberships: { findFirst: vi.fn() },
    organizationFollowers: { findFirst: vi.fn() },
    subscriptions: { findFirst: vi.fn() },
    subscriptionTiers: { findFirst: vi.fn() },
  };
  const tx = { query: mocks, select: emptySelect };
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx));
  return { mocks, transaction };
}

function buildService(
  stub: StubDb,
  options: { revoked?: boolean; purchased?: boolean } = {}
) {
  const { obs, logs } = createMockObservability();
  const isRevoked = vi.fn(async () =>
    options.revoked ? { reason: 'refund' } : null
  );
  const service = new ContentAccessService({
    db: {
      query: stub.mocks,
      transaction: stub.transaction,
      select: emptySelect,
    } as unknown as ServiceConfig['db'],
    environment: 'test',
    r2: {
      generateSignedUrl: vi.fn(async () => 'https://signed.example/stub'),
      getObjectText: vi.fn(async () => null),
    },
    purchaseService: {
      verifyPurchase: vi.fn(async () => options.purchased ?? false),
    } as unknown as PurchaseService,
    revocation: { isRevoked } as unknown as AccessRevocation,
  });
  // Test-only reach-in, as the sibling suites: capture the service's logs.
  (service as unknown as { obs: typeof obs }).obs = obs;
  return { service, logs, isRevoked };
}

const userId = 'user_abc';
const orgId = '6f1c1d52-6d0e-4c43-9a52-6a3f8c2f7b11';
const query = { orgId, slug: 'breathing' };

const periodStart = new Date('2026-10-12T00:00:00.000Z');
const periodEnd = new Date('2026-11-12T00:00:00.000Z');

/** As the lookup returns it: a released row no longer on the storefront. */
const withdrawnRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'content_123',
  slug: 'breathing',
  organizationId: orgId,
  creatorId: 'creator_abc',
  status: 'draft',
  publishedAt: new Date('2026-01-01T00:00:00.000Z'),
  offSaleAt: null,
  isFree: false,
  isPurchasable: true,
  priceCents: 900,
  isTierGated: false,
  isFollowerGated: false,
  isTeamOnly: false,
  courseOnly: false,
  contentBody: 'the paid text',
  contentBodyJson: { type: 'doc' },
  mediaItem: null,
  creator: { id: 'creator_abc', name: 'Rowan' },
  organization: { id: orgId, slug: 'studio', deletedAt: null },
  ...overrides,
});

/** A departed creator's tier item: archived and stamped off sale. */
const departedTierRow = (offSaleAt: Date) =>
  withdrawnRow({
    status: 'archived',
    offSaleAt,
    isPurchasable: false,
    priceCents: null,
    isTierGated: true,
  });

const subscription = {
  userId,
  organizationId: orgId,
  status: 'active',
  currentPeriodStart: periodStart,
  currentPeriodEnd: periodEnd,
};

/** The 404 a reader sees, whatever the reason: keyed on what they sent. */
async function expectTheSame404(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ContentNotFoundError);
  expect((error as ContentNotFoundError).context).toEqual({
    contentId: 'breathing',
    code: 'CONTENT_NOT_FOUND',
  });
}

describe('getWithdrawnContent (Codex-ov2ii)', () => {
  let stub: StubDb;

  beforeEach(() => {
    stub = createStubDb();
    stub.mocks.organizationMemberships.findFirst.mockResolvedValue(undefined);
    stub.mocks.organizationFollowers.findFirst.mockResolvedValue(undefined);
    stub.mocks.subscriptions.findFirst.mockResolvedValue(undefined);
  });

  it('opens an unpublished item for its buyer, without its body', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(withdrawnRow());
    const { service, logs } = buildService(stub, { purchased: true });

    const result = await service.getWithdrawnContent(userId, query);

    expect(result.held).toEqual({ by: 'purchase', until: null });
    expect(result.content.id).toBe('content_123');
    // The body comes from /stream?include=body, never from this read.
    expect(result.content.contentBody).toBeNull();
    expect(result.content.contentBodyJson).toBeNull();
    expect(result.content.categorySlugs).toEqual([]);
    expect(logs).toContainEqual(
      expect.objectContaining({ level: 'info', message: 'Access granted' })
    );
  });

  it('opens a departed creator’s item for a subscriber until their period ends', async () => {
    // Off sale after the period began: the subscriber paid for this period.
    stub.mocks.content.findFirst.mockResolvedValue(
      departedTierRow(new Date('2026-10-20T00:00:00.000Z'))
    );
    stub.mocks.subscriptions.findFirst.mockResolvedValue(subscription);
    const { service } = buildService(stub);

    const result = await service.getWithdrawnContent(userId, query);

    expect(result.held).toEqual({
      by: 'subscription',
      until: '2026-11-12T00:00:00.000Z',
    });
  });

  it('is a 404 for a subscriber who renewed after the item went off sale', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(
      departedTierRow(new Date('2026-10-01T00:00:00.000Z'))
    );
    stub.mocks.subscriptions.findFirst.mockResolvedValue(subscription);
    const { service, logs } = buildService(stub);

    await expectTheSame404(service.getWithdrawnContent(userId, query));
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'info',
        message: 'Withdrawn content: no access',
      })
    );
  });

  it('is a 404 for the team: staff preview drafts in the studio', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(withdrawnRow());
    stub.mocks.organizationMemberships.findFirst.mockResolvedValue({
      id: 'membership_1',
    });
    const { service } = buildService(stub);

    await expectTheSame404(service.getWithdrawnContent(userId, query));
  });

  it('is a 404 for a follower: a follow does not outlive unpublication', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(
      withdrawnRow({
        isPurchasable: false,
        priceCents: null,
        isFollowerGated: true,
      })
    );
    stub.mocks.organizationFollowers.findFirst.mockResolvedValue({
      id: 'follow_1',
    });
    const { service } = buildService(stub);

    await expectTheSame404(service.getWithdrawnContent(userId, query));
  });

  it('is the same 404 when no row matches, so a miss and a denial look alike', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(undefined);
    const { service } = buildService(stub, { purchased: true });

    await expectTheSame404(service.getWithdrawnContent(userId, query));
  });

  it('is a 404 for a piece of a deleted organisation, even to its buyer', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(
      withdrawnRow({
        organization: { id: orgId, slug: 'studio', deletedAt: new Date() },
      })
    );
    const { service } = buildService(stub, { purchased: true });

    await expectTheSame404(service.getWithdrawnContent(userId, query));
  });

  it('is a 404 for a revoked reader, before any database work', async () => {
    const { service, isRevoked, logs } = buildService(stub, {
      revoked: true,
      purchased: true,
    });

    await expectTheSame404(service.getWithdrawnContent(userId, query));
    expect(isRevoked).toHaveBeenCalledWith(userId, orgId);
    expect(stub.transaction).not.toHaveBeenCalled();
    // Logged as getStreamingUrl logs a revoked attempt, for monitoring.
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'getWithdrawnContent blocked — access revoked',
      })
    );
  });

  it('checks no org revocation for a personal piece', async () => {
    stub.mocks.content.findFirst.mockResolvedValue(
      withdrawnRow({ organizationId: null, organization: null })
    );
    const { service, isRevoked } = buildService(stub, { purchased: true });

    const result = await service.getWithdrawnContent(userId, {
      creatorId: 'creator_abc',
      slug: 'breathing',
    });

    expect(result.held.by).toBe('purchase');
    expect(isRevoked).not.toHaveBeenCalled();
  });
});
