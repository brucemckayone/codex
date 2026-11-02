/**
 * Subscription collection: the localStorage entry carries a waiting move
 * (Codex-2hxff.16, data design §8), so the paywall can say "You're moving to
 * Basic on 12 November". `tier` stays the plan the member is on.
 *
 * TanStack DB is mocked, as in `library.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCollection = vi.hoisted(() => ({
  state: new Map<string, unknown>(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));
const remote = vi.hoisted(() => ({ getCurrentSubscription: vi.fn() }));

vi.mock('$app/environment', () => ({
  browser: true,
  dev: false,
  building: false,
  version: 'test',
}));
vi.mock('@tanstack/db', () => ({
  createCollection: vi.fn(() => mockCollection),
  localStorageCollectionOptions: vi.fn((options) => options),
}));
vi.mock('$lib/remote/subscription.remote', () => remote);

import { loadSubscriptionFromServer } from './subscription';

const ORG_ID = 'org-hollow';
const PRO = { id: 'tier-pro', name: 'Pro', sortOrder: 2 };

function current(pendingTierChange: unknown) {
  return {
    tier: PRO,
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-11-12T00:00:00.000Z',
    pendingTierChange,
  };
}

describe('loadSubscriptionFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.state.clear();
  });

  it('stores a waiting move beside the plan the member keeps', async () => {
    remote.getCurrentSubscription.mockResolvedValueOnce(
      current({
        tierId: 'tier-basic',
        tierName: 'Basic',
        amountCents: 500,
        billingInterval: 'month',
        effectiveAt: '2026-11-12T00:00:00.000Z',
        laterPrice: null,
      })
    );

    await loadSubscriptionFromServer(ORG_ID);

    expect(mockCollection.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: PRO,
        pendingTierChange: {
          tierId: 'tier-basic',
          tierName: 'Basic',
          effectiveAt: '2026-11-12T00:00:00.000Z',
        },
      })
    );
  });

  it('stores null when nothing waits, or the worker sends no field', async () => {
    remote.getCurrentSubscription.mockResolvedValueOnce(current(undefined));

    await loadSubscriptionFromServer(ORG_ID);

    expect(mockCollection.insert).toHaveBeenCalledWith(
      expect.objectContaining({ pendingTierChange: null })
    );
  });
});
