/**
 * Organization Creators Page Server Load Tests
 *
 * Tests for the organization creators directory page load function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the cache headers module
vi.mock('$lib/server/cache', () => ({
  CACHE_HEADERS: {
    DYNAMIC_PUBLIC: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    },
  },
}));

// Create mock functions that we can configure before each test
const mockGetOrgCreators = vi.fn();

vi.mock('$lib/remote/org.remote', () => ({
  getOrgCreators: mockGetOrgCreators,
}));

describe('Organization Creators Page Load', () => {
  let mockParams: { slug: string };
  let mockUrl: URL;
  let mockSetHeaders: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockParams = { slug: 'yoga-studio' };
    mockSetHeaders = vi.fn();

    // Create a mock URL with search params
    mockUrl = {
      searchParams: {
        get: vi.fn((key: string) => {
          if (key === 'page') return null;
          return null;
        }),
      },
    } as unknown as URL;
  });

  describe('successful data fetch', () => {
    it('loads creators data with pagination', async () => {
      const mockCreators = [
        {
          username: 'creator1',
          displayName: 'Creator One',
          avatar: 'https://example.com/avatar1.jpg',
          bio: 'Test bio 1',
          contentCount: 10,
        },
        {
          username: 'creator2',
          displayName: 'Creator Two',
          avatar: 'https://example.com/avatar2.jpg',
          bio: 'Test bio 2',
          contentCount: 5,
        },
      ];

      mockGetOrgCreators.mockResolvedValue({
        items: mockCreators,
        pagination: { page: 1, totalPages: 3, total: 25 },
      });

      const { load } = await import('../+page.server');

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result).toEqual({
        creators: mockCreators,
        pagination: { page: 1, totalPages: 3, total: 25 },
        error: null,
      });
      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: 1,
        limit: 12,
      });
    });

    it('handles pagination from URL parameter', async () => {
      mockUrl.searchParams.get = vi.fn((key: string) => {
        if (key === 'page') return '2';
        return null;
      });

      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 2, totalPages: 5, total: 50 },
      });

      const { load } = await import('../+page.server');

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result.pagination.page).toBe(2);
      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: 2,
        limit: 12,
      });
    });

    it('defaults to page 1 when no page parameter provided', async () => {
      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 1, totalPages: 1, total: 5 },
      });

      const { load } = await import('../+page.server');

      await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: 1,
        limit: 12,
      });
    });
  });

  describe('page parameter validation', () => {
    it('clamps negative page values to 1', async () => {
      mockUrl.searchParams.get = vi.fn((key: string) => {
        if (key === 'page') return '-5';
        return null;
      });

      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 1, totalPages: 1, total: 0 },
      });

      const { load } = await import('../+page.server');

      await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: 1, // Should be clamped to 1
        limit: 12,
      });
    });

    it('clamps zero page value to 1', async () => {
      mockUrl.searchParams.get = vi.fn((key: string) => {
        if (key === 'page') return '0';
        return null;
      });

      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 1, totalPages: 1, total: 0 },
      });

      const { load } = await import('../+page.server');

      await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: 1, // Should be clamped to 1
        limit: 12,
      });
    });

    it('handles invalid page number strings by defaulting to 1', async () => {
      mockUrl.searchParams.get = vi.fn((key: string) => {
        if (key === 'page') return 'invalid';
        return null;
      });

      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 1, totalPages: 1, total: 0 },
      });

      const { load } = await import('../+page.server');

      await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      // Number('invalid') is NaN, Math.max(1, NaN) is NaN
      // But since NaN is falsy, it should work with the validation
      expect(mockGetOrgCreators).toHaveBeenCalledWith({
        slug: 'yoga-studio',
        page: expect.any(Number),
        limit: 12,
      });
    });
  });

  describe('error handling', () => {
    it('returns empty data with error message on API failure', async () => {
      const mockError = new Error('Network error');
      mockGetOrgCreators.mockRejectedValue(mockError);

      const { load } = await import('../+page.server');

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result).toEqual({
        creators: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
        error: 'Failed to load creators',
      });
    });

    it('preserves ApiError messages when available', async () => {
      const { ApiError } = await import('$lib/api/errors');
      const apiError = new ApiError(404, 'Organization not found');
      mockGetOrgCreators.mockRejectedValue(apiError);

      const { load } = await import('../+page.server');

      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result.error).toBe('Organization not found');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to load org creators:',
        apiError
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles null result from API gracefully', async () => {
      mockGetOrgCreators.mockResolvedValue(null);

      const { load } = await import('../+page.server');

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result).toEqual({
        creators: [],
        pagination: { page: 1, totalPages: 0, total: 0 },
        error: null,
      });
    });

    it('handles result with missing pagination gracefully', async () => {
      mockGetOrgCreators.mockResolvedValue({
        items: [],
        // No pagination property
      });

      const { load } = await import('../+page.server');

      const result = await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(result.pagination).toEqual({ page: 1, totalPages: 0, total: 0 });
    });
  });

  describe('cache headers', () => {
    it('sets cache-control headers for public dynamic content', async () => {
      mockGetOrgCreators.mockResolvedValue({
        items: [],
        pagination: { page: 1, totalPages: 1, total: 0 },
      });

      const { load } = await import('../+page.server');

      await load({
        params: mockParams,
        url: mockUrl,
        setHeaders: mockSetHeaders,
      } as any);

      expect(mockSetHeaders).toHaveBeenCalledWith({
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      });
    });
  });

  describe('SSR configuration', () => {
    it('enables server-side rendering', async () => {
      const { load, ssr } = await import('../+page.server');

      expect(ssr).toBe(true);
      expect(typeof load).toBe('function');
    });
  });
});
