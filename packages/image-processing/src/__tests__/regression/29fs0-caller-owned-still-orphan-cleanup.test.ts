/**
 * Codex-29fs0: the four stills whose DB write the CALLER owns get the same
 * failure cleanup as the thumbnail and avatar.
 *
 * `processCategoryCover`, `processCourseCover`, `processCourseHero` and
 * `processCourseSignature` upload sm/md/lg and return the base key; the scoped
 * write happens afterwards in CategoriesService / CourseJourneyService. Before
 * this, a failure in that write stranded all three objects with nothing able
 * to name them. The routes now run the write through
 * `persistStillWithOrphanCleanup`.
 *
 * The bucket is a Map, so "is the live image still readable?" is asserted
 * directly rather than inferred from which methods were called.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { describe, expect, it, vi } from 'vitest';
import type { OrphanedFileService } from '../../orphaned-file-service';
import { ImageProcessingService } from '../../service';

const BASE = 'courses/course-1/hero';
const KEYS = [`${BASE}/sm.webp`, `${BASE}/md.webp`, `${BASE}/lg.webp`];
const WRITE_ERROR = 'Database connection lost';

function bucketHoldingTheNewImage(options: { deleteRejects?: boolean } = {}) {
  const objects = new Map(KEYS.map((k) => [k, 'NEW-BYTES']));
  const del = vi.fn(async (key: string) => {
    if (options.deleteRejects) throw new Error('R2 delete failed');
    objects.delete(key);
  });
  return { objects, del, r2: { delete: del } as unknown as R2Service };
}

function service(r2: R2Service, orphanedFileService?: OrphanedFileService) {
  return new ImageProcessingService({
    db: {} as Database,
    environment: 'test',
    r2Service: r2,
    r2PublicUrlBase: 'https://test.r2.dev',
    orphanedFileService,
  });
}

const failingWrite = () => Promise.reject(new Error(WRITE_ERROR));

describe('persistStillWithOrphanCleanup (Codex-29fs0)', () => {
  it('FIRST upload (nothing stored): a failed write deletes the three new objects and rethrows', async () => {
    const bucket = bucketHoldingTheNewImage();

    await expect(
      service(bucket.r2).persistStillWithOrphanCleanup(
        {
          baseKey: BASE,
          storedBaseKey: null,
          imageType: 'course_hero',
          entityType: 'course',
          entityId: 'course-1',
        },
        failingWrite
      )
    ).rejects.toThrow(WRITE_ERROR);

    expect(bucket.objects.size).toBe(0);
  });

  it('REPLACEMENT (row already holds the key): a failed write deletes NOTHING — the row still addresses them', async () => {
    const bucket = bucketHoldingTheNewImage();

    await expect(
      service(bucket.r2).persistStillWithOrphanCleanup(
        {
          baseKey: BASE,
          storedBaseKey: BASE,
          imageType: 'course_hero',
          entityType: 'course',
          entityId: 'course-1',
        },
        failingWrite
      )
    ).rejects.toThrow(WRITE_ERROR);

    expect(bucket.del).not.toHaveBeenCalled();
    expect([...bucket.objects.keys()]).toEqual(KEYS);
  });

  it('a failed cleanup delete is recorded with the still-specific orphan type', async () => {
    const bucket = bucketHoldingTheNewImage({ deleteRejects: true });
    const recordOrphanedFiles = vi.fn().mockResolvedValue(['o1', 'o2', 'o3']);

    await expect(
      service(bucket.r2, {
        recordOrphanedFiles,
      } as unknown as OrphanedFileService).persistStillWithOrphanCleanup(
        {
          baseKey: 'categories/cat-1/cover',
          storedBaseKey: null,
          imageType: 'category_cover',
          entityType: 'category',
          entityId: 'cat-1',
        },
        failingWrite
      )
    ).rejects.toThrow(WRITE_ERROR);

    expect(recordOrphanedFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        r2Key: 'categories/cat-1/cover/sm.webp',
        imageType: 'category_cover',
        entityType: 'category',
        entityId: 'cat-1',
      }),
      expect.objectContaining({ r2Key: 'categories/cat-1/cover/md.webp' }),
      expect.objectContaining({ r2Key: 'categories/cat-1/cover/lg.webp' }),
    ]);
  });

  it('a successful write returns its result and touches no object', async () => {
    const bucket = bucketHoldingTheNewImage();

    await expect(
      service(bucket.r2).persistStillWithOrphanCleanup(
        {
          baseKey: BASE,
          storedBaseKey: null,
          imageType: 'course_hero',
          entityType: 'course',
          entityId: 'course-1',
        },
        async () => ({ heroImageKey: BASE })
      )
    ).resolves.toEqual({ heroImageKey: BASE });

    expect(bucket.del).not.toHaveBeenCalled();
  });
});
