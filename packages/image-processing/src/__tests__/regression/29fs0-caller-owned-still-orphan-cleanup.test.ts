/**
 * Codex-29fs0: the four stills whose DB write the CALLER owns get the same
 * cleanup as the thumbnail and avatar.
 *
 * `processCategoryCover`, `processCourseCover`, `processCourseHero` and
 * `processCourseSignature` upload sm/md/lg/xl into a new folder and return it
 * (Codex-kk9nv.5); the scoped write happens afterwards in CategoriesService /
 * CourseJourneyService. The routes run that write through
 * `persistStillWithOrphanCleanup`, which deletes the new folder if the write
 * fails and the folder it replaced if the write succeeds. The DELETE routes
 * call `deleteDroppedStill` after clearing the key.
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
/** The folder this upload just wrote. */
const NEW = `${BASE}/1200x800-0a1b2c3d`;
/** The hero the row held before, uploaded since kk9nv.5. */
const OLD = `${BASE}/640x480-ffffffff`;
const WRITE_ERROR = 'Database connection lost';

function folderKeys(folder: string): string[] {
  return ['sm', 'md', 'lg', 'xl'].map((size) => `${folder}/${size}.webp`);
}

/** A bucket holding each named folder's four files. */
function bucketHolding(
  folders: string[],
  options: { deleteRejects?: boolean } = {}
) {
  const objects = new Map(
    folders.flatMap((folder) => folderKeys(folder).map((k) => [k, folder]))
  );
  const del = vi.fn(async (key: string) => {
    if (options.deleteRejects) throw new Error('R2 delete failed');
    objects.delete(key);
  });
  return {
    objects,
    del,
    r2: { delete: del } as unknown as R2Service,
    holds: (folder: string) => folderKeys(folder).every((k) => objects.has(k)),
    holdsNone: (folder: string) =>
      folderKeys(folder).every((k) => !objects.has(k)),
  };
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
const hero = {
  imageType: 'course_hero',
  entityType: 'course',
  entityId: 'course-1',
} as const;

describe('persistStillWithOrphanCleanup (Codex-29fs0, Codex-kk9nv.5)', () => {
  it('a failed write deletes the four NEW objects, keeps the old hero, and rethrows', async () => {
    const bucket = bucketHolding([NEW, OLD]);

    await expect(
      service(bucket.r2).persistStillWithOrphanCleanup(
        { ...hero, key: NEW, storedKey: OLD },
        failingWrite
      )
    ).rejects.toThrow(WRITE_ERROR);

    // All four, xl included — none is left for nothing to name.
    expect(bucket.del.mock.calls.map((call) => call[0])).toEqual(
      folderKeys(NEW)
    );
    expect(bucket.holdsNone(NEW)).toBe(true);
    // The row still addresses the old hero, and it is intact.
    expect(bucket.holds(OLD)).toBe(true);
  });

  it('a successful write returns its result and deletes the hero it replaced', async () => {
    const bucket = bucketHolding([NEW, OLD]);

    await expect(
      service(bucket.r2).persistStillWithOrphanCleanup(
        { ...hero, key: NEW, storedKey: OLD },
        async () => ({ heroImageKey: NEW })
      )
    ).resolves.toEqual({ heroImageKey: NEW });

    expect(bucket.holdsNone(OLD)).toBe(true);
    expect(bucket.holds(NEW)).toBe(true);
  });

  it('replacing a legacy fixed-key hero deletes only its files, never the new folder inside the same base', async () => {
    // A hero from before kk9nv.5 lives AT the base key, and the new folder
    // lives UNDER it. Deleting the legacy files must name them exactly.
    const bucket = bucketHolding([NEW, BASE]);

    await service(bucket.r2).persistStillWithOrphanCleanup(
      { ...hero, key: NEW, storedKey: BASE },
      async () => null
    );

    expect(bucket.holdsNone(BASE)).toBe(true);
    expect(bucket.holds(NEW)).toBe(true);
  });

  it("never deletes a stored key that is not this course's own", async () => {
    // A key set by hand, or a copy, naming another course's hero: the write
    // moves the row off it, and it is still not this course's to delete.
    const foreign = 'courses/course-2/hero/640x480-ffffffff';
    const bucket = bucketHolding([NEW, foreign]);

    await service(bucket.r2).persistStillWithOrphanCleanup(
      { ...hero, key: NEW, storedKey: foreign },
      async () => null
    );

    expect(bucket.del).not.toHaveBeenCalled();
    expect(bucket.holds(foreign)).toBe(true);
  });

  it('refuses a key that is not a new upload of this course, before writing', async () => {
    // A failed write deletes `key`, so only a folder `process*` just made for
    // this entity may be passed. The base itself, another course's folder, or
    // an arbitrary string never reaches the write.
    const bucket = bucketHolding([]);
    const write = vi.fn(async () => null);

    for (const key of [BASE, 'courses/course-2/hero/1x1-00000000', 'x']) {
      await expect(
        service(bucket.r2).persistStillWithOrphanCleanup(
          { ...hero, key, storedKey: null },
          write
        )
      ).rejects.toMatchObject({ statusCode: 500 });
    }
    expect(write).not.toHaveBeenCalled();
    expect(bucket.del).not.toHaveBeenCalled();
  });

  it('a failed cleanup delete is recorded with the still-specific orphan type', async () => {
    const cover = 'categories/cat-1/cover/1200x800-0a1b2c3d';
    const bucket = bucketHolding([cover], { deleteRejects: true });
    const recordOrphanedFiles = vi
      .fn()
      .mockResolvedValue(['o1', 'o2', 'o3', 'o4']);

    await expect(
      service(bucket.r2, {
        recordOrphanedFiles,
      } as unknown as OrphanedFileService).persistStillWithOrphanCleanup(
        {
          key: cover,
          storedKey: null,
          imageType: 'category_cover',
          entityType: 'category',
          entityId: 'cat-1',
        },
        failingWrite
      )
    ).rejects.toThrow(WRITE_ERROR);

    expect(recordOrphanedFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        r2Key: `${cover}/sm.webp`,
        imageType: 'category_cover',
        entityType: 'category',
        entityId: 'cat-1',
      }),
      expect.objectContaining({ r2Key: `${cover}/md.webp` }),
      expect.objectContaining({ r2Key: `${cover}/lg.webp` }),
      expect.objectContaining({ r2Key: `${cover}/xl.webp` }),
    ]);
  });
});

describe('deleteDroppedStill (Codex-kk9nv.5)', () => {
  it("deletes the folder a cleared key named, when it is this course's own", async () => {
    const bucket = bucketHolding([OLD]);

    await service(bucket.r2).deleteDroppedStill({ ...hero, droppedKey: OLD });

    expect(bucket.holdsNone(OLD)).toBe(true);
  });

  it("touches nothing for an empty key or another entity's folder", async () => {
    const foreign = 'courses/course-2/hero/640x480-ffffffff';
    const bucket = bucketHolding([foreign]);

    await service(bucket.r2).deleteDroppedStill({ ...hero, droppedKey: null });
    await service(bucket.r2).deleteDroppedStill({
      ...hero,
      droppedKey: foreign,
    });

    expect(bucket.del).not.toHaveBeenCalled();
  });
});
