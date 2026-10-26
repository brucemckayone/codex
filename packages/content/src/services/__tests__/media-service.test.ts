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

import type { R2Service } from '@codex/cloudflare-clients';
import { TRANSCODING_ERROR_MAX_LENGTH } from '@codex/constants';
import { mediaItems } from '@codex/database/schema';
import {
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { getHlsPrefix, getOriginalKey } from '@codex/transcoding';
import type { CreateMediaItemInput } from '@codex/validation';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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
        r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test-video.mp4'),
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
        r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test-audio.mp3'),
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
        r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
        fileSizeBytes: 1024,
      };

      const result = await service.create(input, creatorId);

      expect(result.status).toBe('uploading');
      expect(result.uploadedAt).toBeNull();
      expect(result.durationSeconds).toBeNull();
    });

    // Codex-58h6c: the key is the file a presigned PUT and the upload
    // fallback overwrite, and the file transcoding reads.
    describe('a storage key the caller names', () => {
      const named = (r2Key: string): CreateMediaItemInput => ({
        title: 'Named key',
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key,
        fileSizeBytes: 1024,
      });
      const stored = (r2Key: string) =>
        db.query.mediaItems.findFirst({
          where: (media, { eq }) => eq(media.r2Key, r2Key),
        });

      it('is used when it is in the creator’s own originals folder', async () => {
        const mine = getOriginalKey(creatorId, crypto.randomUUID(), 'mine.mp4');
        const result = await service.create(named(mine), creatorId);
        expect(result.r2Key).toBe(mine);
      });

      it.each([
        [
          'another creator’s original',
          () =>
            getOriginalKey(otherCreatorId, crypto.randomUUID(), 'theirs.mp4'),
        ],
        [
          'a key in no creator’s folder',
          () => `e2e/originals/${crypto.randomUUID()}/original.mp4`,
        ],
        [
          'the creator’s own key outside originals',
          () => `${creatorId}/hls/${crypto.randomUUID()}/master.m3u8`,
        ],
      ])('is refused, with nothing created: %s', async (_case, key) => {
        const r2Key = key();
        await expect(
          service.create(named(r2Key), creatorId)
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
        expect(await stored(r2Key)).toBeUndefined();
      });
    });
  });

  describe('get', () => {
    it('should retrieve media by id', async () => {
      const created = await service.create(
        {
          title: 'Test Media',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
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
          r2Key: getOriginalKey(
            otherCreatorId,
            crypto.randomUUID(),
            'other.mp4'
          ),
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
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'delete.mp4'),
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
    it('should update what the creator may edit', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
          fileSizeBytes: 1024,
        },
        creatorId
      );

      const updated = await service.update(
        created.id,
        { title: 'Retitled', description: 'About it' },
        creatorId
      );

      expect(updated.title).toBe('Retitled');
      expect(updated.description).toBe('About it');
    });

    it('refuses a lifecycle field, writing nothing', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
          fileSizeBytes: 1024,
        },
        creatorId
      );

      // What a route hands over: JSON off the wire, typed only by its claim.
      const fromTheWire: Parameters<typeof service.update>[1] = JSON.parse(
        '{"title":"T","status":"ready"}'
      );
      await expect(
        service.update(created.id, fromTheWire, creatorId)
      ).rejects.toThrow();
      const after = await service.get(created.id, creatorId);
      expect(after?.status).toBe('uploading');
      expect(after?.title).toBe('Test');
    });

    it('should throw MediaNotFoundError if media does not exist', async () => {
      await expect(
        service.update(
          '00000000-0000-0000-0000-000000000000',
          { title: 'Missing' },
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
          r2Key: getOriginalKey(
            otherCreatorId,
            crypto.randomUUID(),
            'other.mp4'
          ),
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await expect(
        service.update(created.id, { title: 'Not mine' }, creatorId)
      ).rejects.toThrow(MediaNotFoundError);
    });
  });

  describe('recordClientDuration', () => {
    async function created(owner = creatorId) {
      return service.create(
        {
          title: 'Timed',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(owner, crypto.randomUUID(), 'timed.mp4'),
          fileSizeBytes: 1024,
        },
        owner
      );
    }

    it('writes into an empty column', async () => {
      const media = await created();
      await service.recordClientDuration(media.id, creatorId, 137);
      expect((await service.get(media.id, creatorId))?.durationSeconds).toBe(
        137
      );
    });

    it("never overwrites the transcoder's figure", async () => {
      const media = await created();
      await service.recordClientDuration(media.id, creatorId, 1800);
      await service.recordClientDuration(media.id, creatorId, 137);
      expect((await service.get(media.id, creatorId))?.durationSeconds).toBe(
        1800
      );
    });

    it("leaves another creator's item alone", async () => {
      const media = await created(otherCreatorId);
      await service.recordClientDuration(media.id, creatorId, 137);
      expect(
        (await service.get(media.id, otherCreatorId))?.durationSeconds
      ).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status from uploading to uploaded', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
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
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
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
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
          fileSizeBytes: 1024,
        },
        creatorId
      );

      await service.updateStatus(created.id, 'transcoding', creatorId);

      // Use markAsReady() which provides required fields for status='ready'
      const ready = await service.markAsReady(
        created.id,
        {
          hlsMasterPlaylistKey: `hls/${created.id}/master.m3u8`,
          thumbnailKey: `thumbnails/${created.id}/thumb.jpg`,
          durationSeconds: 120,
          width: 1920,
          height: 1080,
        },
        creatorId
      );

      expect(ready.status).toBe('ready');
      expect(ready.hlsMasterPlaylistKey).toBeDefined();
      expect(ready.thumbnailKey).toBeDefined();
      expect(ready.durationSeconds).toBe(120);
    });

    it('should update status from transcoding to failed', async () => {
      const created = await service.create(
        {
          title: 'Test',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
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
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'test.mp4'),
          fileSizeBytes: 1024,
        },
        creatorId
      );
      await service.markUploaded(created.id, creatorId);
      const uploadedAt = (await service.get(created.id, creatorId))?.uploadedAt;

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
      // uploaded_at is when the FILE arrived (markUploaded), the maintenance
      // cron's 24 h clock: finishing the transcode must not move it.
      expect(uploadedAt).toBeInstanceOf(Date);
      expect(ready.uploadedAt?.getTime()).toBe(uploadedAt?.getTime());
    });
  });

  describe('delete', () => {
    it('should soft delete media', async () => {
      const created = await service.create(
        {
          title: 'To Delete',
          mediaType: 'video',
          mimeType: 'video/mp4',
          r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'delete.mp4'),
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
          r2Key: getOriginalKey(
            otherCreatorId,
            crypto.randomUUID(),
            'other.mp4'
          ),
          fileSizeBytes: 1024,
        },
        otherCreatorId
      );

      await expect(service.delete(created.id, creatorId)).rejects.toThrow(
        MediaNotFoundError
      );
    });

    /**
     * R2 cleanup tests — uses a service instance with a mocked R2Service so we
     * can assert the four-prefix sweep behaviour without hitting real R2.
     *
     * The list() mock dispatches per prefix via a per-call key map so each
     * prefix can be primed with its own page set / failure mode.
     */
    describe('R2 cleanup', () => {
      function createMockR2() {
        return {
          put: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue(undefined),
          get: vi.fn(),
          list: vi.fn(),
          putJson: vi.fn(),
          generateSignedUrl: vi.fn(),
          generateSignedUploadUrl: vi
            .fn()
            .mockResolvedValue('https://signed.example.com/upload'),
        };
      }

      type MockR2 = ReturnType<typeof createMockR2>;

      /**
       * Configure mockR2.list to return a fixed page per prefix.
       * Each entry: prefix → array of object keys (single page, not truncated).
       */
      function listByPrefix(
        mockR2: MockR2,
        pages: Record<string, string[]>
      ): void {
        mockR2.list.mockImplementation(
          async ({ prefix }: { prefix: string; cursor?: string }) => {
            const keys = pages[prefix] ?? [];
            return {
              objects: keys.map((key) => ({ key })),
              truncated: false,
            };
          }
        );
      }

      function createServiceWithR2(mockR2: MockR2): MediaItemService {
        return new MediaItemService({
          db,
          environment: 'test',
          r2: mockR2 as unknown as R2Service,
        });
      }

      function expectedPrefixes(
        creator: string,
        mediaId: string
      ): {
        originals: string;
        hls: string;
        thumbnails: string;
        waveforms: string;
      } {
        return {
          originals: `${creator}/originals/${mediaId}/`,
          hls: getHlsPrefix(creator, mediaId),
          thumbnails: `${creator}/thumbnails/${mediaId}/`,
          waveforms: `${creator}/waveforms/${mediaId}/`,
        };
      }

      async function seedMedia(svc: MediaItemService): Promise<{
        id: string;
      }> {
        const created = await svc.create(
          {
            title: 'R2 Cleanup Test',
            mediaType: 'video',
            mimeType: 'video/mp4',
            r2Key: getOriginalKey(
              creatorId,
              crypto.randomUUID(),
              'cleanup.mp4'
            ),
            fileSizeBytes: 1024,
          },
          creatorId
        );
        return { id: created.id };
      }

      it('lists and deletes objects under each of the four prefixes', async () => {
        const mockR2 = createMockR2();
        const svc = createServiceWithR2(mockR2);
        const { id } = await seedMedia(svc);
        const prefixes = expectedPrefixes(creatorId, id);

        listByPrefix(mockR2, {
          [prefixes.originals]: [`${prefixes.originals}media.mp4`],
          [prefixes.hls]: [
            `${prefixes.hls}master.m3u8`,
            `${prefixes.hls}1080p/index.m3u8`,
            `${prefixes.hls}1080p/segment_001.ts`,
          ],
          [prefixes.thumbnails]: [`${prefixes.thumbnails}auto-generated.jpg`],
          [prefixes.waveforms]: [
            `${prefixes.waveforms}waveform.json`,
            `${prefixes.waveforms}waveform.png`,
          ],
        });

        await svc.delete(id, creatorId);

        // list() was called once per prefix
        expect(mockR2.list).toHaveBeenCalledTimes(4);
        for (const prefix of Object.values(prefixes)) {
          expect(mockR2.list).toHaveBeenCalledWith(
            expect.objectContaining({ prefix })
          );
        }

        // Every object across all prefixes was deleted
        const expectedKeys = [
          `${prefixes.originals}media.mp4`,
          `${prefixes.hls}master.m3u8`,
          `${prefixes.hls}1080p/index.m3u8`,
          `${prefixes.hls}1080p/segment_001.ts`,
          `${prefixes.thumbnails}auto-generated.jpg`,
          `${prefixes.waveforms}waveform.json`,
          `${prefixes.waveforms}waveform.png`,
        ];
        for (const key of expectedKeys) {
          expect(mockR2.delete).toHaveBeenCalledWith(key);
        }
        expect(mockR2.delete).toHaveBeenCalledTimes(expectedKeys.length);
      });

      it('isolates per-prefix list failures — other prefixes still sweep', async () => {
        const mockR2 = createMockR2();
        const svc = createServiceWithR2(mockR2);
        const { id } = await seedMedia(svc);
        const prefixes = expectedPrefixes(creatorId, id);

        // Originals prefix throws on list; the other three return one key each.
        mockR2.list.mockImplementation(
          async ({ prefix }: { prefix: string; cursor?: string }) => {
            if (prefix === prefixes.originals) {
              throw new Error('R2 list error on originals');
            }
            const keyByPrefix: Record<string, string> = {
              [prefixes.hls]: `${prefixes.hls}master.m3u8`,
              [prefixes.thumbnails]: `${prefixes.thumbnails}auto-generated.jpg`,
              [prefixes.waveforms]: `${prefixes.waveforms}waveform.json`,
            };
            const key = keyByPrefix[prefix];
            return {
              objects: key ? [{ key }] : [],
              truncated: false,
            };
          }
        );

        // Outer call must NOT throw — failures are swallowed-and-logged
        await expect(svc.delete(id, creatorId)).resolves.not.toThrow();

        // All four prefixes were attempted
        expect(mockR2.list).toHaveBeenCalledTimes(4);

        // The other three prefixes still got their object deleted
        expect(mockR2.delete).toHaveBeenCalledTimes(3);
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.hls}master.m3u8`
        );
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.thumbnails}auto-generated.jpg`
        );
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.waveforms}waveform.json`
        );
      });

      it('isolates per-key delete failures — other keys in the same page still delete', async () => {
        const mockR2 = createMockR2();
        const svc = createServiceWithR2(mockR2);
        const { id } = await seedMedia(svc);
        const prefixes = expectedPrefixes(creatorId, id);

        const hlsKeys = [
          `${prefixes.hls}master.m3u8`,
          `${prefixes.hls}1080p/segment_001.ts`,
          `${prefixes.hls}1080p/segment_002.ts`,
        ];
        listByPrefix(mockR2, {
          [prefixes.originals]: [],
          [prefixes.hls]: hlsKeys,
          [prefixes.thumbnails]: [],
          [prefixes.waveforms]: [],
        });

        // Middle key fails; the others must still be attempted
        mockR2.delete.mockImplementation(async (key: string) => {
          if (key === hlsKeys[1]) {
            throw new Error('R2 delete error');
          }
          return undefined;
        });

        await expect(svc.delete(id, creatorId)).resolves.not.toThrow();

        // All three HLS keys were attempted, including the failed middle one
        expect(mockR2.delete).toHaveBeenCalledTimes(hlsKeys.length);
        for (const key of hlsKeys) {
          expect(mockR2.delete).toHaveBeenCalledWith(key);
        }
      });

      it('follows the cursor across truncated pages within a single prefix', async () => {
        const mockR2 = createMockR2();
        const svc = createServiceWithR2(mockR2);
        const { id } = await seedMedia(svc);
        const prefixes = expectedPrefixes(creatorId, id);

        // Per-prefix call counter so we can return page 1 then page 2 for HLS only.
        const callsByPrefix: Record<string, number> = {};
        mockR2.list.mockImplementation(
          async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
            callsByPrefix[prefix] = (callsByPrefix[prefix] ?? 0) + 1;
            if (prefix === prefixes.hls) {
              if (callsByPrefix[prefix] === 1) {
                expect(cursor).toBeUndefined();
                return {
                  objects: [
                    { key: `${prefixes.hls}1080p/segment_001.ts` },
                    { key: `${prefixes.hls}1080p/segment_002.ts` },
                  ],
                  truncated: true,
                  cursor: 'next-page',
                };
              }
              expect(cursor).toBe('next-page');
              return {
                objects: [{ key: `${prefixes.hls}1080p/segment_003.ts` }],
                truncated: false,
              };
            }
            return { objects: [], truncated: false };
          }
        );

        await svc.delete(id, creatorId);

        // HLS prefix listed twice (page 1 + page 2); other prefixes once each
        const hlsCalls = mockR2.list.mock.calls.filter(
          (call) => (call[0] as { prefix: string }).prefix === prefixes.hls
        );
        expect(hlsCalls).toHaveLength(2);

        // All three segments across both pages were deleted
        expect(mockR2.delete).toHaveBeenCalledTimes(3);
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.hls}1080p/segment_001.ts`
        );
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.hls}1080p/segment_002.ts`
        );
        expect(mockR2.delete).toHaveBeenCalledWith(
          `${prefixes.hls}1080p/segment_003.ts`
        );
      });

      it('does not call any R2 method when MediaNotFoundError throws inside the transaction', async () => {
        const mockR2 = createMockR2();
        const svc = createServiceWithR2(mockR2);

        await expect(
          svc.delete('00000000-0000-0000-0000-000000000000', creatorId)
        ).rejects.toThrow(MediaNotFoundError);

        expect(mockR2.list).not.toHaveBeenCalled();
        expect(mockR2.delete).not.toHaveBeenCalled();
      });
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
            r2Key: getOriginalKey(
              creatorId,
              crypto.randomUUID(),
              `media-${i}.mp4`
            ),
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
      expect(page1.items[0]!.id).not.toBe(page2.items[0]!.id);
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
          r2Key: getOriginalKey(
            otherCreatorId,
            crypto.randomUUID(),
            'other.mp4'
          ),
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
      const mediaToDelete = createdMediaIds[0]!;
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

  const makeUploadingMedia = () =>
    service.create(
      {
        title: 'Trigger failure media',
        mediaType: 'video',
        mimeType: 'video/mp4',
        r2Key: getOriginalKey(creatorId, crypto.randomUUID(), 'tf.mp4'),
        fileSizeBytes: 1024,
      },
      creatorId
    );

  describe('markUploaded', () => {
    it('moves an upload to uploaded and stamps when the file arrived', async () => {
      const created = await makeUploadingMedia();

      await service.markUploaded(created.id, creatorId);

      const after = await service.get(created.id, creatorId);
      expect(after?.status).toBe('uploaded');
      expect(after?.uploadedAt).toBeInstanceOf(Date);
    });

    it('a repeat leaves the stamp: it is the 24 h clock', async () => {
      const created = await makeUploadingMedia();
      await service.markUploaded(created.id, creatorId);
      const first = (await service.get(created.id, creatorId))?.uploadedAt;

      await service.markUploaded(created.id, creatorId);

      const again = (await service.get(created.id, creatorId))?.uploadedAt;
      expect(again?.getTime()).toBe(first?.getTime());
    });

    it('is creator-scoped — never touches another creator’s upload', async () => {
      const created = await makeUploadingMedia();

      await service.markUploaded(created.id, otherCreatorId);

      expect((await service.get(created.id, creatorId))?.status).toBe(
        'uploading'
      );
    });
  });

  describe('recordTranscodingTriggerFailure', () => {
    const makeMedia = async () => {
      const created = await makeUploadingMedia();
      await service.markUploaded(created.id, creatorId);
      return created;
    };

    // The detail lives in the row only: no response serves it (Codex-l2c48).
    const stored = (id: string) =>
      db.query.mediaItems.findFirst({ where: eq(mediaItems.id, id) });

    it('keeps the detail in the row, and no read serves it', async () => {
      const created = await makeMedia();
      await service.recordTranscodingTriggerFailure(
        created.id,
        creatorId,
        'botocore: endpoint https://internal.example returned 503'
      );

      expect((await stored(created.id))?.transcodingError).toContain(
        'botocore'
      );
      const served = await service.get(created.id, creatorId);
      expect(served?.transcodingErrorCode).toBe('TRANSCODER_UNAVAILABLE');
      expect(served).not.toHaveProperty('transcodingError');
      const listed = await service.list(creatorId, {}, { page: 1, limit: 50 });
      const row = listed.items.find((item) => item.id === created.id);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty('transcodingError');
      const updated = await service.update(
        created.id,
        { title: 'Retitled' },
        creatorId
      );
      expect(updated).not.toHaveProperty('transcodingError');
    });

    it('marks the item waiting WITHOUT changing status so re-trigger still works', async () => {
      const created = await makeMedia();

      await service.recordTranscodingTriggerFailure(
        created.id,
        creatorId,
        'Transcoding dispatch returned 503'
      );

      const after = await stored(created.id);
      expect(after?.transcodingError).toBe('Transcoding dispatch returned 503');
      expect(after?.transcodingErrorCode).toBe('TRANSCODER_UNAVAILABLE');
      // Status stays 'uploaded' (not flipped to 'failed') so the idempotent
      // /upload-complete re-POST, and the maintenance cron, can re-dispatch.
      expect(after?.status).toBe('uploaded');
    });

    it('never stamps a row that is not uploaded: media-api may have claimed it', async () => {
      const created = await makeUploadingMedia();

      await service.recordTranscodingTriggerFailure(
        created.id,
        creatorId,
        'Transcoding dispatch returned 503'
      );

      const after = await stored(created.id);
      expect(after?.transcodingError).toBeNull();
      expect(after?.transcodingErrorCode).toBeNull();
    });

    it('truncates the error message to the column limit', async () => {
      const created = await makeMedia();

      await service.recordTranscodingTriggerFailure(
        created.id,
        creatorId,
        'x'.repeat(5000)
      );

      const after = await stored(created.id);
      expect(after?.transcodingError?.length).toBe(
        TRANSCODING_ERROR_MAX_LENGTH
      );
    });

    it('is creator-scoped — never touches another creator’s media', async () => {
      const created = await makeMedia();

      // Wrong creator → matches no rows → silent no-op (no throw, no write).
      await service.recordTranscodingTriggerFailure(
        created.id,
        otherCreatorId,
        'should not be written'
      );

      const after = await stored(created.id);
      expect(after?.transcodingError).toBeNull();
    });
  });
});
