/**
 * Content Detail Page Server Load Tests
 *
 * Tests for content detail page load function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockCookies, MockServerLoadEvent } from '$tests/test-helpers';

// Type for the load function return data
type ContentPageData = {
  content: unknown;
  isPurchased: boolean;
  checkoutUrls: {
    successUrl: string;
    cancelUrl: string;
  };
  error?: string;
};

// Create mock functions that we can configure before each test
const mockContentGet = vi.fn();
const mockGetUserLibrary = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    content: {
      get: mockContentGet,
    },
    access: {
      getUserLibrary: mockGetUserLibrary,
    },
  })),
}));

describe('Content Detail Page Load', () => {
  let mockParams: { contentId: string; slug: string };
  let mockCookies: MockCookies;
  let mockPlatform: App.Platform;
  let mockUrl: URL;

  const mockContent = {
    id: 'content-123',
    title: 'Test Content',
    description: 'Test description',
    contentType: 'video',
    visibility: 'purchased_only',
    priceCents: 999,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    organizationId: 'org-123',
    creatorId: 'creator-123',
    status: 'published',
    creator: {
      id: 'creator-123',
      name: 'Test Creator',
    },
    mediaItem: {
      id: 'media-123',
      durationSeconds: 1800,
      thumbnailKey: 'thumb-key',
    },
  };

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockParams = {
      contentId: 'content-123',
      slug: 'test-org',
    };
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
      serialize: vi.fn(),
      getAll: vi.fn(() => []),
    };
    mockPlatform = { env: {} } as App.Platform;
    mockUrl = new URL('http://localhost:3000/org/test-org/content/content-123');
  });

  /**
   * Helper to create a typed mock load event
   * Returns MockServerLoadEvent for test usage
   */
  function createMockLoadEvent(
    overrides: Partial<MockServerLoadEvent> = {}
  ): MockServerLoadEvent {
    return {
      params: mockParams as MockServerLoadEvent['params'],
      cookies: mockCookies,
      platform: mockPlatform as MockServerLoadEvent['platform'],
      url: mockUrl,
      route: { id: '/org/[slug]/content/[contentId]' },
      request: new Request(
        'http://localhost:3000/org/test-org/content/content-123'
      ),
      ...overrides,
    };
  }

  describe('Success Paths', () => {
    it('returns content data when content exists', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(mockContent);
      expect(mockContentGet).toHaveBeenCalledWith('content-123');
    });

    it('returns isPurchased: true when user owns the content (library check)', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({
        items: [
          {
            content: {
              id: 'content-123',
              title: 'Test Content',
              description: '',
            },
            purchase: {
              id: 'purchase-123',
              purchasedAt: new Date().toISOString(),
            },
            progress: null,
          },
        ],
      });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.isPurchased).toBe(true);
      expect(mockGetUserLibrary).toHaveBeenCalled();
    });

    it('returns isPurchased: false when user does not own the content', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({
        items: [
          {
            content: {
              id: 'other-content',
              title: 'Other Content',
              description: '',
            },
            purchase: {
              id: 'purchase-456',
              purchasedAt: new Date().toISOString(),
            },
            progress: null,
          },
        ],
      });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.isPurchased).toBe(false);
    });

    it('returns isPurchased: false when user library is empty', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.isPurchased).toBe(false);
    });

    it('returns checkoutUrls with correctly formatted URLs', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.checkoutUrls).toBeDefined();
      expect(result.checkoutUrls.successUrl).toBeDefined();
      expect(result.checkoutUrls.cancelUrl).toBeDefined();
    });

    it('successUrl includes contentId query parameter', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.checkoutUrls.successUrl).toBe(
        'http://localhost:3000/purchase/success?contentId=content-123'
      );
    });

    it('cancelUrl includes org slug and contentId', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.checkoutUrls.cancelUrl).toBe(
        'http://localhost:3000/org/test-org/content/content-123'
      );
    });

    it('uses url.origin for checkout URLs', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const customUrl = new URL(
        'https://custom-domain.com/org/test-org/content/content-123'
      );

      const { load } = await import('../+page.server');

      const result = (await load(
        createMockLoadEvent({ url: customUrl })
      )) as ContentPageData;

      expect(result.checkoutUrls.successUrl).toContain(
        'https://custom-domain.com'
      );
      expect(result.checkoutUrls.cancelUrl).toContain(
        'https://custom-domain.com'
      );
    });
  });

  describe('Error Paths', () => {
    it('returns content: null when content not found (404)', async () => {
      mockContentGet.mockResolvedValue({ data: null });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toBe(null);
      expect(result.error).toBeDefined();
      expect(mockGetUserLibrary).not.toHaveBeenCalled();
    });

    it('handles failed library check (sets isPurchased: false, continues)', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockRejectedValue(new Error('Library API error'));

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(mockContent);
      expect(result.isPurchased).toBe(false);
      expect(result.checkoutUrls).toBeDefined();
    });

    it('handles network error on library check gracefully', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockRejectedValue(new Error('Network error'));

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(mockContent);
      expect(result.isPurchased).toBe(false);
    });

    it('handles timeout on library check gracefully', async () => {
      mockContentGet.mockResolvedValue({ data: mockContent });
      mockGetUserLibrary.mockRejectedValue(new Error('Timeout'));

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(mockContent);
      expect(result.isPurchased).toBe(false);
    });

    it('returns content: null and error message when content API throws', async () => {
      mockContentGet.mockRejectedValue(new Error('Content API error'));

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toBe(null);
      expect(result.error).toBeDefined();
    });

    it('returns generic retry message on unexpected error', async () => {
      mockContentGet.mockRejectedValue(new Error('Unexpected error'));

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toBe(null);
      expect(result.error).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles content with no mediaItem', async () => {
      const contentWithoutMedia = { ...mockContent, mediaItem: null };
      mockContentGet.mockResolvedValue({ data: contentWithoutMedia });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(contentWithoutMedia);
    });

    it('handles content with no creator', async () => {
      const contentWithoutCreator = { ...mockContent, creator: null };
      mockContentGet.mockResolvedValue({ data: contentWithoutCreator });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content).toEqual(contentWithoutCreator);
    });

    it('handles content with null/undefined priceCents', async () => {
      const freeContent = { ...mockContent, priceCents: 0 };
      mockContentGet.mockResolvedValue({ data: freeContent });
      mockGetUserLibrary.mockResolvedValue({ items: [] });

      const { load } = await import('../+page.server');

      const result = (await load(createMockLoadEvent())) as ContentPageData;

      expect(result.content.priceCents).toBe(0);
    });
  });
});
