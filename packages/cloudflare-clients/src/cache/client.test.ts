import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CachePurgeClient } from './client';

const ZONE_ID = 'test-zone-id';
const API_TOKEN = 'test-api-token';
const PURGE_URL = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`;

describe('CachePurgeClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('purgeByUrls', () => {
    it('should purge specific URLs successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ success: true, errors: [], messages: [] }),
      });
      globalThis.fetch = mockFetch;

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });
      await client.purgeByUrls([
        'https://example.com/page1',
        'https://example.com/page2',
      ]);

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        PURGE_URL,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            files: ['https://example.com/page1', 'https://example.com/page2'],
          }),
        })
      );
    });

    it('should log errors but never throw on API failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            success: false,
            errors: [{ code: 1000, message: 'Invalid zone' }],
            messages: [],
          }),
      });
      globalThis.fetch = mockFetch;
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });

      // Should not throw
      await expect(
        client.purgeByUrls(['https://example.com/page1'])
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cache purge failed:',
        expect.any(Error)
      );
    });

    it('should log errors but never throw on network failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      globalThis.fetch = mockFetch;
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });

      await expect(
        client.purgeByUrls(['https://example.com/page1'])
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cache purge failed:',
        expect.any(Error)
      );
    });

    it('should batch URLs when exceeding 30 per call', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ success: true, errors: [], messages: [] }),
      });
      globalThis.fetch = mockFetch;

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });

      // 65 URLs should result in 3 batches: 30 + 30 + 5
      const urls = Array.from(
        { length: 65 },
        (_, i) => `https://example.com/page${i}`
      );
      await client.purgeByUrls(urls);

      expect(mockFetch).toHaveBeenCalledTimes(3);

      // First batch: 30 URLs
      const firstCall = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(firstCall.files).toHaveLength(30);

      // Second batch: 30 URLs
      const secondCall = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(secondCall.files).toHaveLength(30);

      // Third batch: 5 URLs
      const thirdCall = JSON.parse(mockFetch.mock.calls[2][1].body);
      expect(thirdCall.files).toHaveLength(5);
    });

    it('should skip when no URLs provided', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });
      await client.purgeByUrls([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('purgeEverything', () => {
    it('should purge all cached content', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ success: true, errors: [], messages: [] }),
      });
      globalThis.fetch = mockFetch;

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });
      await client.purgeEverything();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        PURGE_URL,
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ purge_everything: true }),
        })
      );
    });

    it('should log errors but never throw on failure', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
      globalThis.fetch = mockFetch;
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const client = new CachePurgeClient({
        zoneId: ZONE_ID,
        apiToken: API_TOKEN,
      });

      await expect(client.purgeEverything()).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Cache purge (everything) failed:',
        expect.any(Error)
      );
    });
  });

  describe('no-op client', () => {
    it('should not call fetch when config is not provided', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const client = new CachePurgeClient();
      await client.purgeByUrls(['https://example.com/page1']);
      await client.purgeEverything();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should create no-op client via static factory when config missing', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const client = CachePurgeClient.create(undefined, undefined);
      await client.purgeByUrls(['https://example.com/page1']);
      await client.purgeEverything();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should create enabled client via static factory when config provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({ success: true, errors: [], messages: [] }),
      });
      globalThis.fetch = mockFetch;

      const client = CachePurgeClient.create(ZONE_ID, API_TOKEN);
      await client.purgeByUrls(['https://example.com/page1']);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });
});
