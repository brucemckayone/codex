/**
 * Media Item Service Tests
 *
 * Comprehensive test suite for MediaItemService covering:
 * - Media creation (valid formats, validation)
 * - Media retrieval (by id, scope enforcement)
 * - Media updates (status transitions, metadata)
 * - Media deletion (soft delete, scope)
 * - List operations (pagination, filtering)
 * - Creator ownership enforcement
 * - Error handling
 *
 * Test Count: 20+ tests
 *
 * Database Isolation:
 * - Uses neon-testing for ephemeral branch per test file
 * - Each test creates its own data (idempotent tests)
 * - No cleanup needed - fresh database for this file
 */

import {
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import type { CreateMediaItemInput } from '@codex/validation';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MediaNotFoundError } from '../../errors';
import { MediaItemService } from '../media-service';

// Uses workflow-level Neon branch in CI, LOCAL_PROXY locally

describe('MediaItemService', () => {
  let db: Database;
  let service: MediaItemService;
  let creatorId: string;
  let otherCreatorId: string;

  beforeAll(async () => {
    db = setupTestDatabase();
    service = new MediaItemService({ db, environment: 'test' });

    const userIds = await seedTestUsers(db, 2);
    [creatorId, otherCreatorId] = userIds;
  });

  // No cleanup needed - neon-testing provides fresh database per file

  afterAll(async () => {
    await teardownTestDatabase();
  });

  describe('create', () => {
    it('should create video media item', async () => {
      const input: CreateMediaItemInput = {
        title: 'Test Video',
        description: 'Test video description',
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: 'originals/test-video.mp4',
        fileSizeBytes: 1024 * 1024 * 10,
      };

      const result = await service.create(input, creatorId);

      expect(result.id).toBeDefined();
      expect(result.creatorId).toBe(creatorId);
      expect(result.title).toBe(input.title);
      expect(result.mediaType).toBe('video');
      expect(result.status).toBe('uploading');
      expect(result.fileSizeBytes).toBe(input.fileSizeBytes);
    });

    it('should create audio media item', async () => {
      const input: CreateMediaItemInput = {
        title: 'Test Audio',
        mediaType: 'audio',
        mimeType: 'audio/mpeg',
        r2Key: 'originals/test-audio.mp3',
        fileSizeBytes: 1024 * 1024 * 5,
      };

      const result = await service.create(input, creatorId);

      expect(result.mediaType).toBe('audio');
      expect(result.status).toBe('uploading');
    });

    it('should set initial status to uploading', async () => {
      const input: CreateMediaItemInput = {
        title: 'Test',
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: 'originals/test.mp4',
        fileSizeBytes: 1024,
      };

      const result = await service.create(input, creatorId);

      expect(result.status).toBe('uploading');
      expect(result.uploadedAt).toBeNull();
      expect(result.durationSeconds).toBeNull();
    });
  });

  describe('get', () => {
    it('should retrieve media by id', async () => {
      const created = await service.create(
        {
          title: 'Test Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      const result = await service.get(created.id, creatorId);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result?.creator).toBeDefined();
    });

    it('should return null for non-existent media', async () => {
      const result = await service.get(
        '00000000-0000-0000-0000-000000000000',
        creatorId
      );

      expect(result).toBeNull();
    });

    it('should return null for other creator media', async () => {
      const created = await service.create(
        {
          title: 'Other Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/other.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      const result = await service.get(created.id, creatorId);

      expect(result).toBeNull();
    });

    it('should return null for soft-deleted media', async () => {
      const created = await service.create(
        {
          title: 'To Delete',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/delete.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.delete(created.id, creatorId);
      const result = await service.get(created.id, creatorId);

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update media metadata', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      const updated = await service.update(
        created.id,
        {
          durationSeconds: 120,
          width: 1920,
          height: 1080,
        },
        creatorId
      );

      expect(updated.durationSeconds).toBe(120);
      expect(updated.width).toBe(1920);
      expect(updated.height).toBe(1080);
    });

    it('should throw MediaNotFoundError if media does not exist', async () => {
      await expect(
        service.update(
          '00000000-0000-0000-0000-000000000000',
          { status: 'ready' },
          creatorId
        )
      ).rejects.toThrow(MediaNotFoundError);
    });

    it('should throw MediaNotFoundError if updating other creator media', async () => {
      const created = await service.create(
        {
          title: 'Other',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/other.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await expect(
        service.update(created.id, { status: 'ready' }, creatorId)
      ).rejects.toThrow(MediaNotFoundError);
    });
  });

  describe('updateStatus', () => {
    it('should update status from uploading to uploaded', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      expect(created.status).toBe('uploading');

      const updated = await service.updateStatus(
        created.id,
        'uploaded',
        creatorId
      );

      expect(updated.status).toBe('uploaded');
    });

    it('should update status from uploaded to transcoding', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.updateStatus(created.id, 'uploaded', creatorId);
      const transcoding = await service.updateStatus(
        created.id,
        'transcoding',
        creatorId
      );

      expect(transcoding.status).toBe('transcoding');
    });

    it('should update status from transcoding to ready', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.updateStatus(created.id, 'transcoding', creatorId);
      const ready = await service.updateStatus(created.id, 'ready', creatorId);

      expect(ready.status).toBe('ready');
    });

    it('should update status from transcoding to failed', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.updateStatus(created.id, 'transcoding', creatorId);
      const failed = await service.updateStatus(
        created.id,
        'failed',
        creatorId
      );

      expect(failed.status).toBe('failed');
    });
  });

  describe('markAsReady', () => {
    it('should mark media as ready with transcoding metadata', async () => {
      const created = await service.create(
        {
          title: 'Test Video',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/test.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      const metadata = {
        hlsMasterPlaylistKey: 'hls/test/master.m3u8',
        thumbnailKey: 'thumbnails/test/thumb.jpg',
        durationSeconds: 300,
        width: 1920,
        height: 1080,
      };

      const ready = await service.markAsReady(created.id, metadata, creatorId);

      expect(ready.status).toBe('ready');
      expect(ready.hlsMasterPlaylistKey).toBe(metadata.hlsMasterPlaylistKey);
      expect(ready.thumbnailKey).toBe(metadata.thumbnailKey);
      expect(ready.durationSeconds).toBe(metadata.durationSeconds);
      expect(ready.width).toBe(metadata.width);
      expect(ready.height).toBe(metadata.height);
      expect(ready.uploadedAt).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('should soft delete media', async () => {
      const created = await service.create(
        {
          title: 'To Delete',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/delete.mp4',
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.delete(created.id, creatorId);

      const result = await service.get(created.id, creatorId);
      expect(result).toBeNull();
    });

    it('should throw MediaNotFoundError if media does not exist', async () => {
      await expect(
        service.delete('00000000-0000-0000-0000-000000000000', creatorId)
      ).rejects.toThrow(MediaNotFoundError);
    });

    it('should throw MediaNotFoundError if deleting other creator media', async () => {
      const created = await service.create(
        {
          title: 'Other',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/other.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await expect(service.delete(created.id, creatorId)).rejects.toThrow(
        MediaNotFoundError
      );
    });
  });

  describe('list', () => {
    let createdMediaIds: string[] = [];

    beforeEach(async () => {
      // Reset the array for each test
      createdMediaIds = [];

      // Create test media and track their IDs
      for (let i = 0; i < 5; i++) {
        const created = await service.create(
          {
            title: `Media ${i}`,
            mediaType: i % 2 === 0 ? 'video' : 'audio',
            mimeType: i % 2 === 0 ? 'video/mp4' : 'audio/mpeg',
            r2Key: `originals/media-${i}.mp4`,
            fileSizeBytes: 1024 * (i + 1),
          },
          creatorId
        );
        createdMediaIds.push(created.id);
      }
    });

    it('should list all media for creator', async () => {
      const result = await service.list(creatorId);

      // Assert: Verify we have at least the media we created
      expect(result.items.length).toBeGreaterThanOrEqual(5);
      expect(result.pagination.total).toBeGreaterThanOrEqual(5);
      expect(result.pagination.page).toBe(1);

      // Verify our created media items are in the list
      for (const mediaId of createdMediaIds) {
        expect(result.items.some((item) => item.id === mediaId)).toBe(true);
      }
    });

    it('should paginate media list', async () => {
      const page1 = await service.list(creatorId, {}, { page: 1, limit: 2 });

      expect(page1.items).toHaveLength(2);
      expect(page1.pagination.totalPages).toBeGreaterThanOrEqual(3);

      const page2 = await service.list(creatorId, {}, { page: 2, limit: 2 });

      expect(page2.items).toHaveLength(2);
      expect(page1.items[0].id).not.toBe(page2.items[0].id);
    });

    it('should filter by status', async () => {
      const result = await service.list(creatorId, { status: 'uploading' });

      expect(result.items.length).toBeGreaterThan(0);
      result.items.forEach((item) => {
        expect(item.status).toBe('uploading');
      });
    });

    it('should filter by media type', async () => {
      const videos = await service.list(creatorId, { mediaType: 'video' });
      const audio = await service.list(creatorId, { mediaType: 'audio' });

      expect(videos.items.length).toBeGreaterThan(0);
      expect(audio.items.length).toBeGreaterThan(0);

      videos.items.forEach((item) => {
        expect(item.mediaType).toBe('video');
      });

      audio.items.forEach((item) => {
        expect(item.mediaType).toBe('audio');
      });
    });

    it('should not return other creator media', async () => {
      await service.create(
        {
          title: 'Other Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: 'originals/other.mp4',
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      const result = await service.list(creatorId);

      // Assert: Should have our media and only see own media
      expect(result.items.length).toBeGreaterThanOrEqual(5);
      for (const mediaId of createdMediaIds) {
        expect(result.items.some((item) => item.id === mediaId)).toBe(true);
      }
      result.items.forEach((item) => {
        expect(item.creatorId).toBe(creatorId);
      });
    });

    it('should not return soft-deleted media', async () => {
      // Arrange: Delete one of our created media items
      const mediaToDelete = createdMediaIds[0];
      await service.delete(mediaToDelete, creatorId);

      // Act
      const result = await service.list(creatorId);

      // Assert: The deleted item should not be in the results
      expect(result.items.some((item) => item.id === mediaToDelete)).toBe(
        false
      );

      // The remaining items we created should still be there
      const remainingIds = createdMediaIds.slice(1);
      for (const mediaId of remainingIds) {
        expect(result.items.some((item) => item.id === mediaId)).toBe(true);
      }
    });
  });
});
