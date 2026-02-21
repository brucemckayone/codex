/**
 * Payment Page Server Load Tests
 *
 * Tests for account payment page load function.
 */

import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  let mockLocals: { user: { id: string; email: string } | null };
  let mockSetHeaders: ReturnType<typeof vi.fn>;
  let mockPlatform: App.Platform;
  let mockCookies: ReturnType<typeof vi.fn>;
  let mockUrl: URL;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockLocals = {
      user: { id: 'user-123', email: 'test@example.com' },
    };
    mockSetHeaders = vi.fn();
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
    };
    mockUrl = new URL('http://localhost:3000/account/payment');
  });

  it('redirects to login when locals.user is null', async () => {
    mockLocals.user = null;

    const { load } = await import('../+page.server');

    await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(redirect).toHaveBeenCalledWith(
      303,
      '/login?redirect=/account/payment'
    );
  });

  it('parses default pagination params (page 1, limit 20)', async () => {
    const purchasesData = {
      items: [
        {
          id: 'purchase-1',
          createdAt: '2025-01-15T10:30:00.000Z',
          contentId: 'content-123',
          contentTitle: 'Test Content',
          amountCents: 1000,
          status: 'complete' as const,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    const expectedParams = new URLSearchParams();
    expectedParams.set('limit', '50');
    expect(mockGetPurchaseHistory).toHaveBeenCalledWith(expectedParams);
  });

  it('parses status filter param', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?status=complete');
    const purchasesData = {
      items: [
        {
          id: 'purchase-1',
          createdAt: '2025-01-15T10:30:00.000Z',
          contentId: 'content-123',
          contentTitle: 'Test Content',
          amountCents: 1000,
          status: 'complete' as const,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    mockGetPurchaseHistory.mockResolvedValue(purchasesData);

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result).toEqual({
      purchases: purchasesData,
      filters: { status: 'complete' },
    });
    const expectedParams = new URLSearchParams();
    expectedParams.set('status', 'complete');
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

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(mockSetHeaders).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-cache',
    });
  });

  it('handles API timeout gracefully', async () => {
    mockGetPurchaseHistory.mockRejectedValue(new Error('Timeout'));

    const { load } = await import('../+page.server');

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

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

    const result = await load({
      locals: mockLocals,
      url: mockUrl,
      setHeaders: mockSetHeaders,
      platform: mockPlatform,
      cookies: mockCookies,
    } as any);

    expect(result.purchases.items).toEqual([]);
    expect(result.purchases.pagination.total).toBe(0);
  });
});
