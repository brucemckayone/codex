/**
 * Payment Page Server Load Tests
 *
 * Tests for account payment page load function.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockCookies, MockServerLoadEvent } from '$tests/test-helpers';

// Type for the load function return data
type PaymentPageData = {
  purchases: {
    items: unknown[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
  filters: {
    status: string | null;
  };
};

// Mock SvelteKit modules before importing
vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn(),
}));

// Create mock functions that we can configure before each test
const mockGetPurchaseHistory = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    account: {
      getPurchaseHistory: mockGetPurchaseHistory,
    },
  })),
}));

describe('Payment Page Load', () => {
  let mockLocals: Partial<App.Locals>;
  let mockSetHeaders: ReturnType<typeof vi.fn>;
  let mockPlatform: App.Platform;
  let mockCookies: MockCookies;
  let mockUrl: URL;

  // Mock user object with all required UserData fields
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    emailVerified: true,
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockLocals = {
      user: mockUser,
    };
    mockSetHeaders = vi.fn();
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(() => []),
    };
    mockUrl = new URL('http://localhost:3000/account/payment');
  });

  /**
   * Helper to create a typed mock load event
   * Returns MockServerLoadEvent for test usage
   */
  function createMockLoadEvent(
    overrides: Partial<MockServerLoadEvent> = {}
  ): MockServerLoadEvent {
    return {
      params: {},
      cookies: mockCookies,
      platform: mockPlatform as MockServerLoadEvent['platform'],
      url: mockUrl,
      route: { id: '/account/payment' },
      locals: mockLocals,
      setHeaders: mockSetHeaders,
      request: new Request('http://localhost:3000/account/payment'),
      ...overrides,
    };
  }

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load(createMockLoadEvent({ locals: mockLocals }));

    expect(redirect).toHaveBeenCalledWith(
      303,
      '/login?redirect=/account/payment'
    );
  });

  it('parses default pagination params (page 1, limit 20)', async () => {
    const purchasesData = {
      items: [{ id: 'purchase-1', amount: 1000, status: 'completed' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      purchases: purchasesData,
      filters: { status: null },
    });
    // Default params (page 1, limit 20) create empty URLSearchParams
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(new URLSearchParams());
  });

  it('parses custom page param', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?page=3');
    const purchasesData = {
      items: [],
      pagination: { page: 3, limit: 20, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      purchases: purchasesData,
      filters: { status: null },
    });
    const expectedParams = new URLSearchParams();
    expectedParams.set('page', '3');
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(expectedParams);
  });

  it('parses custom limit param', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?limit=50');
    const purchasesData = {
      items: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    await load(createMockLoadEvent());

    const expectedParams = new URLSearchParams();
    expectedParams.set('limit', '50');
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(expectedParams);
  });

  it('parses status filter param', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?status=completed');
    const purchasesData = {
      items: [{ id: 'purchase-1', amount: 1000, status: 'completed' }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      purchases: purchasesData,
      filters: { status: 'completed' },
    });
    const expectedParams = new URLSearchParams();
    expectedParams.set('status', 'completed');
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(expectedParams);
  });

  it('parses combined pagination and filter params', async () => {
    mockUrl = new URL(
      'http://localhost:3000/account/payment?page=2&limit=10&status=pending'
    );
    const purchasesData = {
      items: [],
      pagination: { page: 2, limit: 10, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      purchases: purchasesData,
      filters: { status: 'pending' },
    });
    const expectedParams = new URLSearchParams();
    expectedParams.set('page', '2');
    expectedParams.set('limit', '10');
    expectedParams.set('status', 'pending');
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(expectedParams);
  });

  it('handles API failure gracefully with empty state', async () => {
    mockGetPurchaseHistory.mockRejectedValue(new Error('API Error'));

    const { load } = await import('../+page.server');

    const result = await load(createMockLoadEvent());

    expect(result).toEqual({
      purchases: {
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      },
      filters: { status: null },
    });
  });

  it('sets cache-control headers', async () => {
    const purchasesData = {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    await load(createMockLoadEvent());

    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-cache',
    });
  });

  it('handles API timeout gracefully', async () => {
    mockGetPurchaseHistory.mockRejectedValue(new Error('Timeout'));

    const { load } = await import('../+page.server');

    const result = (await load(createMockLoadEvent())) as PaymentPageData;

    expect(result.purchases.items).toEqual([]);
    expect(result.purchases.pagination.total).toBe(0);
  });

  it('handles invalid page param by defaulting to 1', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?page=invalid');
    const purchasesData = {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    await load(createMockLoadEvent());

    // parseInt('invalid', 10) returns NaN, which is falsy, so page defaults to 1
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(new URLSearchParams());
  });

  it('handles empty purchase history gracefully', async () => {
    const emptyData = {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    mockGetPurchaseHistory.mockResolvedValue(emptyData);

    const { load } = await import('../+page.server');

    const result = (await load(createMockLoadEvent())) as PaymentPageData;

    expect(result.purchases.items).toEqual([]);
    expect(result.purchases.pagination.total).toBe(0);
  });
});
