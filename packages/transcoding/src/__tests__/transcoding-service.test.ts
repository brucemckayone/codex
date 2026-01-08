import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TranscodingService,
  type TranscodingServiceFullConfig,
} from '../services/transcoding-service';
import type { MediaStatus, MediaType, RunPodWebhookPayload } from '../types';

// Mock Dependencies
const mockDb = {
  query: {
    mediaItems: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
};

const mockConfig = {
  db: mockDb as unknown as TranscodingServiceFullConfig['db'],
  environment: 'test',
  runpodApiKey: 'mock-api-key',
  runpodEndpointId: 'mock-endpoint-id',
  webhookBaseUrl: 'https://api.example.com',
  hmacSecret: 'mock-secret',
} as TranscodingServiceFullConfig;

describe('TranscodingService', () => {
  let service: TranscodingService;

  beforeEach(() => {
    service = new TranscodingService(mockConfig);
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triggerJob', () => {
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';
    const creatorId = 'user_123';

    // Valid media item for testing
    const validMedia = {
      id: mediaId,
      creatorId,
      status: 'uploaded' as MediaStatus,
      mediaType: 'video' as MediaType,
      r2Key: 'user_123/originals/uuid/video.mp4',
      transcodingPriority: 1,
    };

    it('should successfully trigger a job for uploaded media', async () => {
      // Mock DB findFirst
      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);

      // Mock RunPod API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'runpod-job-123' }),
      });

      // Mock DB update
      mockDb.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({}),
        }),
      });

      await service.triggerJob(mediaId, creatorId);

      // Verify RunPod API called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.runpod.ai/v2/${mockConfig.runpodEndpointId}/run`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockConfig.runpodApiKey}`,
          }),
          body: expect.stringContaining(mediaId),
        })
      );

      // Verify DB update status='transcoding'
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should throw Error if media is not in uploaded state', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        ...validMedia,
        status: 'transcoding', // Invalid state for trigger
      });

      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
        /Media must be in 'uploaded' status/
      );
    });

    it('should throw Error if r2Key is missing', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        ...validMedia,
        r2Key: null,
      });

      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
        /Input file not uploaded/
      );
    });

    it('should throw Error if RunPod API fails', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);

      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Internal Server Error',
      });

      await expect(service.triggerJob(mediaId, creatorId)).rejects.toThrow(
        /RunPod API error/
      );
    });
  });

  describe('handleWebhook', () => {
    const jobId = 'runpod-job-123';
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';

    it('should update status to ready and save keys on success', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'completed',
        output: {
          mediaId,
          type: 'video',
          hlsMasterKey: 'path/to/master.m3u8',
          hlsPreviewKey: 'path/to/preview.m3u8',
          thumbnailKey: 'path/to/thumb.jpg',
          waveformKey: null,
          waveformImageKey: null,
          durationSeconds: 120,
          width: 1920,
          height: 1080,
          readyVariants: ['1080p', '720p'],
        } as any, // Cast as any because mezzanineKey is missing from type definition in some versions
      };

      // Mock DB to return media in 'transcoding' state
      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
      });

      // Mock update chain
      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(mockDb.update).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          hlsMasterPlaylistKey: 'path/to/master.m3u8',
          durationSeconds: 120,
        })
      );
    });

    it('should update status to failed on error', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'failed',
        error: 'Transcoding failed due to GPU error',
        output: { mediaId } as any,
      };

      // Mock DB to return media in 'transcoding' state
      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          transcodingError: 'Transcoding failed due to GPU error',
        })
      );
    });
  });
});
