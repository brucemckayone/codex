/**
 * Pricing page server load — loadError discriminator tests.
 *
 * Focused on the `currentSubscription` envelope: previously the server
 * swallowed API errors with `.catch(() => null)`, indistinguishable from
 * "user has no subscription". A logged-in subscriber hitting a transient
 * API error would then see the "Subscribe" CTA and crash into
 * AlreadySubscribedError at checkout. The new envelope returns
 * `{ data, loadError }` so the client can refuse to Subscribe until we
 * know the truth.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const tiersListMock = vi.fn();
const getCurrentMock = vi.fn();
const contentMock = vi.fn();
const statsMock = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    tiers: { list: tiersListMock },
    subscription: { getCurrent: getCurrentMock },
    content: { getPublicContent: contentMock },
    org: { getPublicStats: statsMock },
  })),
}));

vi.mock('$lib/server/cache', () => ({
  CACHE_HEADERS: {
    PRIVATE: { 'cache-control': 'private' },
    DYNAMIC_PUBLIC_REVALIDATE: { 'cache-control': 'public, max-age=0' },
  },
}));

describe('pricing page — currentSubscription envelope', () => {
  type LoadInput = Parameters<typeof import('../+page.server').load>[0];

  const baseInput = (user: { id: string } | null): LoadInput =>
    ({
      parent: async () => ({ org: { id: 'org-1', slug: 'demo' } }),
      locals: { user },
      platform: { env: {} },
      cookies: {},
      setHeaders: vi.fn(),
    }) as unknown as LoadInput;

  beforeEach(() => {
    vi.clearAllMocks();
    tiersListMock.mockResolvedValue([]);
    contentMock.mockResolvedValue({ items: [] });
    statsMock.mockResolvedValue(null);
  });

  it('unauthenticated: returns { data: null, loadError: false } without calling getCurrent', async () => {
    const { load } = await import('../+page.server');

    const result = await load(baseInput(null));

    await expect(result.currentSubscription).resolves.toEqual({
      data: null,
      loadError: false,
    });
    expect(getCurrentMock).not.toHaveBeenCalled();
  });

  it('authenticated: wraps a successful subscription in { data, loadError: false }', async () => {
    const fixture = {
      id: 'sub-1',
      tierId: 'tier-1',
      status: 'active',
      cancelAtPeriodEnd: false,
    };
    getCurrentMock.mockResolvedValueOnce(fixture);

    const { load } = await import('../+page.server');

    const result = await load(baseInput({ id: 'user-1' }));

    await expect(result.currentSubscription).resolves.toEqual({
      data: fixture,
      loadError: false,
    });
    expect(getCurrentMock).toHaveBeenCalledWith('org-1');
  });

  it('authenticated: wraps an API error in { data: null, loadError: true }', async () => {
    getCurrentMock.mockRejectedValueOnce(new Error('ecom worker unreachable'));

    const { load } = await import('../+page.server');

    const result = await load(baseInput({ id: 'user-1' }));

    await expect(result.currentSubscription).resolves.toEqual({
      data: null,
      loadError: true,
    });
  });
});
