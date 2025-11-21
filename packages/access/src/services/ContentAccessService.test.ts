import type { Database } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAccessService, type R2Signer } from './ContentAccessService';

const validUUID = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
const userId = 'user-123';

// Mocks
const mockDb = {
  query: {
    content: {
      findFirst: vi.fn(),
    },
    contentAccess: {
      findFirst: vi.fn(),
    },
    videoPlayback: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    purchases: {
      findMany: vi.fn(),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn(),
} as unknown as Database;

const mockR2: R2Signer = {
  generateSignedUrl: vi.fn(),
};

const mockObs = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trackError: vi.fn(),
} as unknown as ObservabilityClient;

describe('ContentAccessService', () => {
  let service: ContentAccessService;

  beforeEach(() => {
    service = new ContentAccessService({
      db: mockDb,
      r2: mockR2,
      obs: mockObs,
    });
    vi.clearAllMocks();
  });

  describe('getStreamingUrl', () => {
    it('should return a streaming URL for free content', async () => {
      const contentId = validUUID;
      const contentRecord = {
        id: contentId,
        status: 'published',
        deletedAt: null,
        priceCents: 0,
        mediaItem: {
          id: 'media-1',
          r2Key: 'creator/hls/media-1/master.m3u8',
          mediaType: 'video',
        },
      };
      mockDb.query.content.findFirst.mockResolvedValue(contentRecord);
      mockR2.generateSignedUrl.mockResolvedValue('https://signed.url');

      const result = await service.getStreamingUrl(userId, {
        contentId,
        expirySeconds: 3600,
      });

      expect(result.streamingUrl).toBe('https://signed.url');
      expect(result.contentType).toBe('video');
      expect(mockDb.query.contentAccess.findFirst).not.toHaveBeenCalled();
    });

    it('should return a streaming URL for paid content with access', async () => {
      const contentId = validUUID;
      const contentRecord = {
        id: contentId,
        status: 'published',
        deletedAt: null,
        priceCents: 1000,
        mediaItem: {
          id: 'media-1',
          r2Key: 'creator/hls/media-1/master.m3u8',
          mediaType: 'video',
        },
      };
      mockDb.query.content.findFirst.mockResolvedValue(contentRecord);
      mockDb.query.contentAccess.findFirst.mockResolvedValue({
        id: 'access-1',
      });
      mockR2.generateSignedUrl.mockResolvedValue('https://signed.url');

      await service.getStreamingUrl(userId, {
        contentId,
        expirySeconds: 3600,
      });

      expect(mockDb.query.contentAccess.findFirst).toHaveBeenCalledWith({
        where: expect.anything(),
      });
      expect(mockR2.generateSignedUrl).toHaveBeenCalled();
    });

    it('should throw ACCESS_DENIED for paid content without access', async () => {
      const contentId = validUUID;
      const contentRecord = {
        id: contentId,
        status: 'published',
        deletedAt: null,
        priceCents: 1000,
        mediaItem: {
          id: 'media-1',
          r2Key: 'creator/hls/media-1/master.m3u8',
          mediaType: 'video',
        },
      };
      mockDb.query.content.findFirst.mockResolvedValue(contentRecord);
      mockDb.query.contentAccess.findFirst.mockResolvedValue(null);

      await expect(
        service.getStreamingUrl(userId, { contentId, expirySeconds: 3600 })
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('should throw CONTENT_NOT_FOUND if content does not exist', async () => {
      mockDb.query.content.findFirst.mockResolvedValue(null);

      await expect(
        service.getStreamingUrl(userId, {
          contentId: validUUID,
          expirySeconds: 3600,
        })
      ).rejects.toThrow('CONTENT_NOT_FOUND');
    });
  });

  describe('savePlaybackProgress', () => {
    it('should call upsert with correct values', async () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 100,
        durationSeconds: 200,
        completed: false,
      };
      await service.savePlaybackProgress(userId, input);
      expect(mockDb.insert).toHaveBeenCalledWith(expect.anything()); // videoPlayback table
      expect(mockDb.values).toHaveBeenCalledWith({
        userId,
        contentId: input.contentId,
        positionSeconds: input.positionSeconds,
        durationSeconds: input.durationSeconds,
        completed: false,
      });
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalled();
    });

    it('should mark as completed if progress is >= 95%', async () => {
      const input = {
        contentId: validUUID,
        positionSeconds: 190,
        durationSeconds: 200,
      };
      await service.savePlaybackProgress(userId, input);
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ completed: true })
      );
    });
  });

  describe('getPlaybackProgress', () => {
    it('should return progress if it exists', async () => {
      const progressRecord = {
        positionSeconds: 100,
        durationSeconds: 200,
        completed: false,
        updatedAt: new Date(),
      };
      mockDb.query.videoPlayback.findFirst.mockResolvedValue(progressRecord);
      const result = await service.getPlaybackProgress(userId, {
        contentId: validUUID,
      });
      expect(result).toEqual(progressRecord);
    });

    it('should return null if no progress exists', async () => {
      mockDb.query.videoPlayback.findFirst.mockResolvedValue(null);
      const result = await service.getPlaybackProgress(userId, {
        contentId: validUUID,
      });
      expect(result).toBeNull();
    });
  });

  // Note: listUserLibrary is complex to unit test fully without better mock data support.
  // These are basic sanity checks.
  describe('listUserLibrary', () => {
    it('should return an empty list if no purchases are found', async () => {
      mockDb.query.purchases.findMany.mockResolvedValue([]);
      const result = await service.listUserLibrary(userId, {
        page: 1,
        limit: 20,
      });
      expect(result.items).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });
});
