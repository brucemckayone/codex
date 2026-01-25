import { closeDbPool, dbHttp, dbWs, schema } from '@codex/database';
import { cleanupDatabase, createUniqueSlug } from '@codex/test-utils';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authFixture } from '../fixtures/auth.fixture';
import { setupDatabaseFixture } from '../fixtures/database.fixture';
import { httpClient } from '../helpers/http-client';
import type { RegisteredUser } from '../helpers/types';
import { WORKER_URLS } from '../helpers/worker-urls';

// For HMAC signature generation
const RUNPOD_WEBHOOK_SECRET =
  process.env.RUNPOD_WEBHOOK_SECRET || 'test-webhook-secret';

describe('Media Workflow (Content-API <-> Media-API)', () => {
  let creator: RegisteredUser;

  beforeAll(async () => {
    const fixture = await setupDatabaseFixture();

    // CRITICAL: Clean the database to avoid side effects from previous runs
    // This is essential when using hardcoded job IDs or reusable slugs
    await cleanupDatabase(fixture.db);

    creator = await authFixture.registerUser({
      email: `creator-${createUniqueSlug()}@example.com`,
      password: 'Password123!',
      role: 'creator',
    });
  });

  afterAll(async () => {
    await closeDbPool();
  });

  // Helper to generate HMAC signature
  async function generateRunpodSignature(
    payload: object
  ): Promise<{ signature: string; timestamp: string }> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${timestamp}.${JSON.stringify(payload)}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(RUNPOD_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(message)
    );

    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return { signature, timestamp };
  }

  describe('Happy Path: Upload -> Transcode -> Ready', () => {
    let mediaId: string;
    const testJobId = `job-${createUniqueSlug()}`;

    it('should create media item in uploading state', async () => {
      const res = await httpClient.post(`${WORKER_URLS.content}/api/media`, {
        headers: { Cookie: creator.cookie },
        data: {
          title: 'Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          fileSizeBytes: 1024 * 1024 * 10,
          r2Key: `uploads/${creator.user.id}/test-video.mp4`,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      mediaId = body.data.id;
      expect(body.data.status).toBe('uploading');
    });

    it('should trigger transcoding when upload completes', async () => {
      const res = await httpClient.post(
        `${WORKER_URLS.content}/api/media/${mediaId}/upload-complete`,
        {
          headers: { Cookie: creator.cookie },
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(['uploaded', 'transcoding']).toContain(body.data.status);

      // Verify DB status directly
      const media = await dbWs.query.mediaItems.findFirst({
        where: eq(schema.mediaItems.id, mediaId),
      });
      expect(['uploaded', 'transcoding']).toContain(media?.status);
    });

    it('should accept valid webhook from RunPod and mark ready', async () => {
      // Force to transcoding state using the same DB connection type as workers
      await dbHttp
        .update(schema.mediaItems)
        .set({ status: 'transcoding', runpodJobId: testJobId })
        .where(eq(schema.mediaItems.id, mediaId));

      const payload = {
        jobId: testJobId,
        status: 'completed',
        output: {
          mediaId: mediaId,
          type: 'video',
          hlsMasterKey: 'hls/master.m3u8',
          hlsPreviewKey: 'hls/preview.mp4',
          thumbnailKey: 'thumb.jpg',
          durationSeconds: 120,
          width: 1920,
          height: 1080,
          readyVariants: ['1080p', '720p'],
        },
      };

      const { signature, timestamp } = await generateRunpodSignature(payload);

      const res = await httpClient.post(
        `${WORKER_URLS.media}/api/transcoding/webhook`,
        {
          headers: {
            'X-Runpod-Signature': signature,
            'X-Runpod-Timestamp': timestamp,
          },
          data: payload,
        }
      );

      expect(res.status).toBe(200);

      // Wait for propagation
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify status updated to ready via WebSocket client
      const media = await dbWs.query.mediaItems.findFirst({
        where: eq(schema.mediaItems.id, mediaId),
      });
      expect(media?.status).toBe('ready');
    });
  });

  describe('Failure & Retry Flow', () => {
    let mediaId: string;
    const failJobId = `fail-${createUniqueSlug()}`;

    it('should handle transcoding failure via webhook', async () => {
      const createRes = await httpClient.post(
        `${WORKER_URLS.content}/api/media`,
        {
          headers: { Cookie: creator.cookie },
          data: {
            title: 'Failed Video',
            mediaType: 'video',
            mimeType: 'video/mp4',
            fileSizeBytes: 100,
            r2Key: `uploads/${creator.user.id}/fail.mp4`,
          },
        }
      );
      mediaId = (await createRes.json()).data.id;

      await dbHttp
        .update(schema.mediaItems)
        .set({ status: 'transcoding', runpodJobId: failJobId })
        .where(eq(schema.mediaItems.id, mediaId));

      const payload = {
        jobId: failJobId,
        status: 'failed',
        error: 'Corrupted input file',
      };

      const { signature, timestamp } = await generateRunpodSignature(payload);

      const res = await httpClient.post(
        `${WORKER_URLS.media}/api/transcoding/webhook`,
        {
          headers: {
            'X-Runpod-Signature': signature,
            'X-Runpod-Timestamp': timestamp,
          },
          data: payload,
        }
      );

      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const media = await dbWs.query.mediaItems.findFirst({
        where: eq(schema.mediaItems.id, mediaId),
      });
      expect(media?.status).toBe('failed');
      expect(media?.transcodingError).toBe('Corrupted input file');
    });

    it('should allow retrying failed transcoding', async () => {
      const res = await httpClient.post(
        `${WORKER_URLS.media}/api/transcoding/retry/${mediaId}`,
        {
          headers: { Cookie: creator.cookie },
        }
      );

      expect(res.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1000));

      const media = await dbWs.query.mediaItems.findFirst({
        where: eq(schema.mediaItems.id, mediaId),
      });
      expect(media?.status).not.toBe('failed');
      expect(media?.transcodingAttempts).toBeGreaterThan(0);
    });
  });
});
