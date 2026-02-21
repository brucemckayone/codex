/**
 * Purchase Success Page Server Load Tests
 *
 * Tests for purchase success page load function.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Create mock functions that we can configure before each test
const mockContentGet = vi.fn();

vi.mock('$lib/server/api', () => ({
  createServerApi: vi.fn(() => ({
    content: {
      get: mockContentGet,
    },
  })),
}));

describe('Purchase Success Page Load', () => {
  let mockUrl: URL;
  let mockPlatform: App.Platform;
  let mockCookies: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Setup default mock values
    mockUrl = new URL('https://example.com/purchase/success');
    mockPlatform = { env: {} } as App.Platform;
    mockCookies = {
      get: vi.fn(() => 'session-cookie'),
      set: vi.fn(),
      delete: vi.fn(),
    };
  });

  describe('Success Paths', () => {
    it('returns content when contentId query param is valid', async () => {
      const contentId = 'content-123';
      mockUrl.searchParams.set('contentId', contentId);

      const contentData = {
        id: contentId,
        title: 'Test Content',
        description: 'Test Description',
      };
      mockContentGet.mockResolvedValue({ data: contentData });

      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: contentData,
        sessionId: null,
      });
      expect(mockContentGet).toHaveBeenCalledWith(contentId);
    });

    it('returns sessionId from query params when present', async () => {
      const sessionId = 'session_abc123';
      mockUrl.searchParams.set('session_id', sessionId);
      mockUrl.searchParams.set('contentId', 'content-123');

      const contentData = { id: 'content-123', title: 'Test Content' };
      mockContentGet.mockResolvedValue({ data: contentData });

      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: contentData,
        sessionId,
      });
    });

    it('returns sessionId: null when not in query params', async () => {
      mockUrl.searchParams.set('contentId', 'content-123');

      const contentData = { id: 'content-123', title: 'Test Content' };
      mockContentGet.mockResolvedValue({ data: contentData });

      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: contentData,
        sessionId: null,
      });
    });

    it('returns content: null when contentId is missing', async () => {
      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: null,
        sessionId: null,
      });
      expect(mockContentGet).not.toHaveBeenCalled();
    });
  });

  describe('Error Paths', () => {
    it('returns content: null when API call fails', async () => {
      const contentId = 'content-123';
      mockUrl.searchParams.set('contentId', contentId);

      mockContentGet.mockRejectedValue(new Error('API Error'));

      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: null,
        sessionId: null,
      });
    });

    it('returns sessionId even when content lookup fails', async () => {
      const sessionId = 'session_abc123';
      const contentId = 'content-123';
      mockUrl.searchParams.set('session_id', sessionId);
      mockUrl.searchParams.set('contentId', contentId);

      mockContentGet.mockRejectedValue(new Error('Not Found'));

      const { load } = await import('../+page.server');

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toEqual({
        content: null,
        sessionId,
      });
    });

    it('does not throw on API errors', async () => {
      const contentId = 'content-123';
      mockUrl.searchParams.set('contentId', contentId);

      mockContentGet.mockRejectedValue(new Error('Network Error'));

      const { load } = await import('../+page.server');

      await expect(
        load({
          url: mockUrl,
          platform: mockPlatform,
          cookies: mockCookies,
        } as any)
      ).resolves.toBeDefined();

      const result = await load({
        url: mockUrl,
        platform: mockPlatform,
        cookies: mockCookies,
      } as any);

      expect(result).toHaveProperty('content', null);
    });
  });
});
