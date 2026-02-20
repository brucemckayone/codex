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

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(),
}));

describe('Payment Page Load', () => {
  let mockLocals: { user: { id: string; email: string } | null };
  let mockSetHeaders: ReturnType<typeof vi.fn>;
  let mockPlatform: App.Platform;
  let mockCookies: ReturnType<typeof vi.fn>;
  let mockUrl: URL;
  let mockGetPurchaseHistory: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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
    mockGetPurchaseHistory = vi.fn();

    // Mock createServerApi to return account API
    const { createServerApi } = await import('$lib/server/api');
    vi.mocked(createServerApi).mockReturnValue({
      account: {
        getPurchaseHistory: mockGetPurchaseHistory,
      },
    } as any);
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

  it('loads purchase history from API when authenticated', async () => {
    const purchasesData = {
      items: [
        {
          id: 'purchase-1',
          createdAt: '2025-01-15T10:30:00Z',
          amountCents: 999,
          status: 'complete',
          contentTitle: 'Test Content',
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
  });

  it('parses page param correctly', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?page=2');
    const purchasesData = {
      items: [],
      pagination: { page: 2, limit: 20, total: 0, totalPages: 0 },
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

    expect(mockGetPurchaseHistory).toHaveBeenCalled();
  });

  it('parses status filter param correctly', async () => {
    mockUrl = new URL('http://localhost:3000/account/payment?status=complete');
    const purchasesData = {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
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

    expect(result.filters.status).toBe('complete');
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

    expect(result.purchases.items).toEqual([]);
    expect(result.purchases.pagination.total).toBe(0);
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
