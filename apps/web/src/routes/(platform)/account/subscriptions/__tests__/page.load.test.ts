/**
 * Subscriptions Page Server Load Tests
 *
 * Covers:
 * 1. `load()` registers `depends('account:subscriptions')` exactly once.
 * 2. `load()` returns `{ subscriptions, loadError: false }` from the API.
 * 3. When the API throws, `load()` returns `{ subscriptions: [], loadError: true }`
 *    so the page renders a retry alert instead of the +error boundary.
 *
 * Auth gating lives on the parent layout, so this load function does not
 * redirect on its own.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock for `createServerApi` — the load fn depends on it.
const getMineMock = vi.fn();
vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    subscription: { getMine: getMineMock },
  })),
}));

describe('Account Subscriptions Page Load', () => {
  type LoadInput = Parameters<typeof import('../+page.server').load>[0];

  let mockPlatform: App.Platform;
  let mockCookies: LoadInput['cookies'];
  let depends: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getMineMock.mockReset();

    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(),
    } as unknown as LoadInput['cookies'];
    depends = vi.fn();
  });

  it("registers depends('account:subscriptions') exactly once", async () => {
    getMineMock.mockResolvedValueOnce([]);

    const { load } = await import('../+page.server');

    await load({
      platform: mockPlatform,
      cookies: mockCookies,
      depends,
    } as unknown as LoadInput);

    expect(depends).toHaveBeenCalledTimes(1);
    expect(depends).toHaveBeenCalledWith('account:subscriptions');
  });

  it('returns { subscriptions, loadError: false } from api.subscription.getMine()', async () => {
    const fixture = [
      {
        id: 'sub-1',
        organizationId: 'org-1',
        status: 'active',
      },
    ];
    getMineMock.mockResolvedValueOnce(fixture);

    const { load } = await import('../+page.server');

    const result = await load({
      platform: mockPlatform,
      cookies: mockCookies,
      depends,
    } as unknown as LoadInput);

    expect(result).toEqual({ subscriptions: fixture, loadError: false });
    expect(getMineMock).toHaveBeenCalledTimes(1);
  });

  it('returns loadError: true on API failure (no full-page 500)', async () => {
    // Previously the load function let errors propagate, which would render
    // the global +error.svelte and obscure the fact that only this one API
    // call failed. The new discriminator lets the page render a retry alert
    // inline while keeping the rest of the account layout intact.
    getMineMock.mockRejectedValueOnce(new Error('ecom worker unreachable'));

    const { load } = await import('../+page.server');

    const result = await load({
      platform: mockPlatform,
      cookies: mockCookies,
      depends,
    } as unknown as LoadInput);

    expect(result).toEqual({ subscriptions: [], loadError: true });
    expect(getMineMock).toHaveBeenCalledTimes(1);
  });
});
