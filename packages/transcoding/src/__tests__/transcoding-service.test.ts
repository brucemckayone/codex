import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
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
  runpodApiBaseUrl: 'https://api.mock', // For testing with mock RunPod
  runpodTimeout: 30000,
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
      (global.fetch as Mock).mockResolvedValue({
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
        `${mockConfig.runpodApiBaseUrl}/${mockConfig.runpodEndpointId}/run`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockConfig.runpodApiKey}`,
          }),
          body: expect.stringContaining(mediaId),
        })
      );
      // Verify storage credentials are NOT in body (security: configured in RunPod env)
      const call = (global.fetch as Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];
      const body = JSON.parse(call[1].body as string);
      // Should NOT have B2 or R2 credentials in payload
      expect(body.input.b2Endpoint).toBeUndefined();
      expect(body.input.b2AccessKeyId).toBeUndefined();
      expect(body.input.b2SecretAccessKey).toBeUndefined();
      expect(body.input.b2BucketName).toBeUndefined();
      expect(body.input.r2Endpoint).toBeUndefined();
      expect(body.input.r2AccessKeyId).toBeUndefined();
      expect(body.input.r2SecretAccessKey).toBeUndefined();
      expect(body.input.r2BucketName).toBeUndefined();
      // Should only have path information
      expect(body.input.inputKey).toBeDefined();
      expect(body.input.webhookUrl).toBeDefined();
      // Verify required fields ARE present
      expect(body.input).toMatchObject({
        mediaId,
        type: 'video',
        creatorId,
        webhookUrl: expect.stringContaining('/api/transcoding/webhook'),
      });

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

      (global.fetch as Mock).mockResolvedValue({
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
          durationSeconds: 120,
          width: 1920,
          height: 1080,
          readyVariants: ['1080p', '720p'],
        },
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

    it('should update status to failed on error and increment transcodingAttempts', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'failed',
        error: 'Transcoding failed due to GPU error',
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 1,
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
          transcodingAttempts: 2,
        })
      );
    });

    it('should reject completed webhook with empty readyVariants', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'completed',
        output: {
          mediaId,
          type: 'video',
          hlsMasterKey: 'path/to/master.m3u8',
          durationSeconds: 120,
          width: 320,
          height: 240,
          readyVariants: [],
        },
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 0,
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          transcodingError:
            'Transcoding completed but produced no playable variants',
          transcodingAttempts: 1,
        })
      );
    });

    it('should store mezzanineKey on completed webhook', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'completed',
        output: {
          mediaId,
          type: 'video',
          hlsMasterKey: 'path/to/master.m3u8',
          thumbnailKey: 'path/to/thumb.webp',
          durationSeconds: 120,
          width: 1920,
          height: 1080,
          readyVariants: ['1080p', '720p'],
          mezzanineKey: 'user_123/mezzanine/media-456/mezzanine.mp4',
        },
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 0,
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          mezzanineKey: 'user_123/mezzanine/media-456/mezzanine.mp4',
          mezzanineStatus: 'ready',
        })
      );
    });

    it('should accept source variant in readyVariants', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'completed',
        output: {
          mediaId,
          type: 'video',
          hlsMasterKey: 'path/to/master.m3u8',
          thumbnailKey: 'path/to/thumb.webp',
          durationSeconds: 3,
          width: 320,
          height: 240,
          readyVariants: ['source'],
        },
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 0,
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          readyVariants: ['source'],
        })
      );
    });

    // ----- Codex-d3g6 sub-item 4: fallback-mediaId lookup + progress clearing -----

    it('should look up media via top-level fallback mediaId when output.mediaId is absent (failure path)', async () => {
      // Python handler sends top-level mediaId on failure when runpodJobId
      // hasn't been stored yet (local /runsync flow — Codex-49y3 contract).
      const payload: RunPodWebhookPayload & { mediaId?: string } = {
        jobId: jobId,
        status: 'failed',
        error: 'Dispatch failed before jobId was stored',
        mediaId, // top-level fallback mediaId
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: null, // jobId not yet stored — fallback path required
        transcodingAttempts: 0,
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      // Verify findFirst was called (the OR clause includes the fallback mediaId)
      expect(mockDb.query.mediaItems.findFirst).toHaveBeenCalled();
      // Verify the failure update was applied with the resolved media
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          transcodingError: 'Dispatch failed before jobId was stored',
          transcodingAttempts: 1,
        })
      );
    });

    it('should clear transcodingProgress and transcodingStep on completed webhook', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'completed',
        output: {
          mediaId,
          type: 'video',
          hlsMasterKey: 'path/to/master.m3u8',
          durationSeconds: 60,
          width: 1280,
          height: 720,
          readyVariants: ['720p'],
        },
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 0,
        transcodingProgress: 95, // mid-flight progress
        transcodingStep: 'finalizing',
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready',
          transcodingError: null,
          transcodingProgress: null,
          transcodingStep: null,
        })
      );
    });

    it('should clear transcodingProgress and transcodingStep on failed webhook', async () => {
      const payload: RunPodWebhookPayload = {
        jobId: jobId,
        status: 'failed',
        error: 'GPU OOM',
      };

      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        id: mediaId,
        status: 'transcoding',
        runpodJobId: jobId,
        transcodingAttempts: 1,
        transcodingProgress: 42,
        transcodingStep: 'encoding_variants',
      });

      const returningMock = vi.fn().mockResolvedValue([{ id: mediaId }]);
      const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleWebhook(payload);

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          transcodingProgress: null,
          transcodingStep: null,
        })
      );
    });
  });

  // ============================================================================
  // Codex-d3g6 sub-item 2: handleProgressWebhook
  // ============================================================================
  describe('handleProgressWebhook', () => {
    const jobId = 'runpod-job-progress-1';
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';

    it('should update transcodingProgress and transcodingStep with valid mediaId', async () => {
      const whereMock = vi.fn().mockResolvedValue({});
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleProgressWebhook({
        jobId,
        status: 'progress',
        progress: 42,
        step: 'encoding_variants',
        mediaId,
      });

      expect(mockDb.update).toHaveBeenCalled();
      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transcodingProgress: 42,
          transcodingStep: 'encoding_variants',
        })
      );
    });

    it("should be a no-op for terminal status (only matches WHERE status='transcoding')", async () => {
      // The DB update has a WHERE clause requiring status='transcoding'.
      // Drizzle returns an empty rowset for non-matching updates — the call
      // still goes through but does not affect terminal-state media.
      const whereMock = vi.fn().mockResolvedValue([]); // no rows affected
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await expect(
        service.handleProgressWebhook({
          jobId,
          status: 'progress',
          progress: 50,
          step: 'finalizing',
          mediaId,
        })
      ).resolves.toBeUndefined();

      // Update was attempted, but the WHERE clause filters by status='transcoding'.
      // Verify the WHERE filter exists by checking that whereMock was called.
      expect(whereMock).toHaveBeenCalled();
    });

    it('should match via mediaId fallback when payload includes both jobId and mediaId', async () => {
      // The OR clause matches either runpodJobId OR mediaId; this exercises
      // the local /runsync flow where runpodJobId may not yet be stored.
      const whereMock = vi.fn().mockResolvedValue({});
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await service.handleProgressWebhook({
        jobId,
        status: 'progress',
        progress: 10,
        step: 'downloading',
        mediaId,
      });

      // The where clause was constructed; we can't directly inspect Drizzle's
      // SQL fragment, but we can verify the call shape includes both update fn
      // and the where call (which holds the OR(eq(runpodJobId, jobId),
      // eq(id, mediaId)) condition).
      expect(setMock).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
    });

    it('should re-throw DB errors after logging (not silently swallow)', async () => {
      // Per docstring: "Fire-and-forget: silently ignores updates for
      // completed/failed jobs." — but DB *errors* (vs no-op updates) ARE
      // logged and re-thrown so the route handler can wrap them.
      const dbError = new Error('connection refused');
      const whereMock = vi.fn().mockRejectedValue(dbError);
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await expect(
        service.handleProgressWebhook({
          jobId,
          status: 'progress',
          progress: 25,
          step: 'mezzanine',
          mediaId,
        })
      ).rejects.toThrow('connection refused');
    });

    it('should accept payload without mediaId (jobId-only match)', async () => {
      const whereMock = vi.fn().mockResolvedValue({});
      const setMock = vi.fn().mockReturnValue({ where: whereMock });
      mockDb.update.mockReturnValue({ set: setMock });

      await expect(
        service.handleProgressWebhook({
          jobId,
          status: 'progress',
          progress: 75,
          step: 'thumbnails',
          // mediaId intentionally omitted — RunPod cloud flow stores jobId first
        })
      ).resolves.toBeUndefined();

      expect(setMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transcodingProgress: 75,
          transcodingStep: 'thumbnails',
        })
      );
    });
  });

  // ============================================================================
  // Codex-d3g6 sub-item 3: triggerJobInternal async refactor (post-Codex-49y3)
  // ============================================================================
  describe('triggerJobInternal async refactor', () => {
    const mediaId = '550e8400-e29b-41d4-a716-446655440000';
    const creatorId = 'user_internal_123';

    const validMedia = {
      id: mediaId,
      creatorId,
      status: 'uploaded' as MediaStatus,
      mediaType: 'video' as MediaType,
      r2Key: 'user_internal_123/originals/uuid/video.mp4',
      transcodingPriority: 2,
    };

    it('returns an object containing dispatchPromise (not void)', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);

      const updateWhereMock = vi.fn().mockResolvedValue({});
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      // RunPod fetch succeeds (consumed inside dispatchPromise)
      (global.fetch as Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'runpod-job-internal-1' }),
      });

      const result = await service.triggerJobInternal(mediaId);

      expect(result).toBeDefined();
      expect(result.dispatchPromise).toBeInstanceOf(Promise);

      // Drain the dispatch promise to avoid unhandled rejections in test runner
      await result.dispatchPromise;
    });

    it('updates DB status to transcoding BEFORE calling RunPod (ordering)', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);

      const callOrder: string[] = [];
      const updateWhereMock = vi.fn().mockImplementation(async () => {
        callOrder.push('db.update');
        return {};
      });
      const updateSetMock = vi.fn().mockReturnValue({ where: updateWhereMock });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      (global.fetch as Mock).mockImplementation(async () => {
        callOrder.push('runpod.fetch');
        return {
          ok: true,
          json: async () => ({ id: 'runpod-job-internal-2' }),
        };
      });

      const result = await service.triggerJobInternal(mediaId);
      // The DB update should already have happened by the time
      // triggerJobInternal returns (it awaits the update before dispatching).
      expect(callOrder[0]).toBe('db.update');
      // Drain dispatch promise — fetch happens inside it.
      await result.dispatchPromise;
      expect(callOrder).toContain('runpod.fetch');
      // The fetch must occur AFTER the first DB update.
      expect(callOrder.indexOf('db.update')).toBeLessThan(
        callOrder.indexOf('runpod.fetch')
      );
    });

    it('marks media as failed (via markTranscodingFailed) when RunPod dispatch rejects', async () => {
      mockDb.query.mediaItems.findFirst.mockResolvedValue(validMedia);

      const setCalls: Array<Record<string, unknown>> = [];
      const updateWhereMock = vi.fn().mockResolvedValue({});
      const updateSetMock = vi.fn().mockImplementation((payload) => {
        setCalls.push(payload as Record<string, unknown>);
        return { where: updateWhereMock };
      });
      mockDb.update.mockReturnValue({ set: updateSetMock });

      // RunPod call throws — dispatch must catch and mark failed
      (global.fetch as Mock).mockRejectedValue(
        new Error('Network unreachable')
      );

      const result = await service.triggerJobInternal(mediaId);
      // Dispatch should NOT throw out of the promise — markTranscodingFailed
      // catches and logs (per docstring).
      await expect(result.dispatchPromise).resolves.toBeUndefined();

      // Look for the failure-marking update among recorded set() calls
      const failedSet = setCalls.find((c) => c.status === 'failed');
      expect(failedSet).toBeDefined();
      expect(failedSet).toMatchObject({
        status: 'failed',
        transcodingError: expect.stringContaining('Network unreachable'),
        transcodingProgress: null,
        transcodingStep: null,
      });
    });

    it('rejects with InvalidMediaStateError when media is not in uploaded status (TOCTOU guard)', async () => {
      // The atomic WHERE clause requires status='uploaded' — but the upfront
      // status check throws InvalidMediaStateError synchronously before the
      // DB update fires.
      mockDb.query.mediaItems.findFirst.mockResolvedValue({
        ...validMedia,
        status: 'transcoding',
      });

      await expect(service.triggerJobInternal(mediaId)).rejects.toThrow(
        /uploaded/i
      );
      // Verify no fetch happened — guard tripped before dispatch
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
