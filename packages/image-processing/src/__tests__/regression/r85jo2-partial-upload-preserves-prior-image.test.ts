/**
 * Codex-r85jo.2 — a partial image upload must not DELETE the previous image.
 *
 * ## The bug this proved gone, and why the fix changed shape (Codex-kk9nv.5)
 *
 * `uploadImageVariants` used to delete ALL variant keys whenever ANY put
 * rejected. Under the keys of that time, deterministic per `(creatorId,
 * contentId)` with no nonce, those were the keys the row ALREADY pointed at,
 * so the "rollback" 404'd the live image. The r85jo.2 fix was to delete
 * NOTHING on a partial failure and let the fixed keys self-heal on retry.
 *
 * Since kk9nv.5 every upload writes a NEW folder,
 * `{base}/{w}x{h}-{8 hex}/{sm,md,lg,xl}.webp`. The previous image sits in a
 * different folder (or, uploaded before kk9nv.5, at the old fixed keys), and
 * nothing references the new folder until the row is written. So the safe
 * response has inverted: whatever landed in the new folder is deleted, and the
 * previous image's keys are never touched at all.
 *
 * ## What these tests assert
 *
 * The bucket is modelled as a `Map`, seeded with a previous image, so each
 * assertion is the acceptance criterion's own wording — every key the previous
 * image occupied is still READABLE — plus the new half: nothing the failed
 * upload wrote is left behind.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../../processor';
import { ImageProcessingService } from '../../service';

vi.mock('../../processor', () => ({
  processStillVariants: vi.fn(),
}));

const R2_BASE = 'https://test.r2.dev';
const CONTENT_ID = 'content-1';
const CREATOR_ID = 'user-1';
const THUMBNAIL_BASE = `${CREATOR_ID}/content-thumbnails/${CONTENT_ID}`;

/** The files of one still folder, in put order. */
function folderKeys(folder: string): string[] {
  return ['sm', 'md', 'lg', 'xl'].map((size) => `${folder}/${size}.webp`);
}

/** A previous image uploaded before kk9nv.5: fixed keys under the base. */
const LEGACY_FOLDER = THUMBNAIL_BASE;
/** A previous image uploaded since: its own sized folder. */
const PRIOR_FOLDER = `${THUMBNAIL_BASE}/640x480-0a1b2c3d`;

/** Bytes standing in for the image that is already live in the bucket. */
const PRIOR = 'PREVIOUS-IMAGE-BYTES';

/**
 * A minimal R2 stand-in backed by a Map, so a test can ask the question that
 * actually matters — "is this key still readable?" — instead of inspecting
 * which methods were called.
 *
 * `rejectNewPut` names the size whose put fails for a key the bucket does not
 * already hold, which is the mid-sequence transient failure (a 500, a quota
 * rejection) the upload reacts to.
 */
function createBucket(
  priorFolder: string,
  options: { rejectNewPut?: 'sm' | 'md' | 'lg' | 'xl' } = {}
) {
  const priorKeys = folderKeys(priorFolder);
  const objects = new Map<string, string>(
    priorKeys.map((key) => [key, PRIOR] as const)
  );

  const put = vi.fn(async (key: string, body: Uint8Array) => {
    if (
      options.rejectNewPut &&
      key.endsWith(`/${options.rejectNewPut}.webp`) &&
      !priorKeys.includes(key)
    ) {
      throw new Error('R2 transient failure: 500');
    }
    objects.set(key, `NEW-${body.byteLength}`);
  });

  const del = vi.fn(async (key: string) => {
    objects.delete(key);
  });

  return {
    objects,
    priorKeys,
    put,
    delete: del,
    r2: { put, delete: del } as unknown as R2Service,
    /** Keys the bucket holds that the previous image did not. */
    newKeys: () => [...objects.keys()].filter((k) => !priorKeys.includes(k)),
  };
}

/** A DB that reads `priorUrl` back and whose update resolves or rejects. */
function createDb(priorUrl: string | null, update: 'passes' | 'fails') {
  const where =
    update === 'passes'
      ? vi.fn().mockResolvedValue([{ id: CONTENT_ID }])
      : vi.fn().mockRejectedValue(new Error('Database connection lost'));
  const db = {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where }),
    }),
    query: {
      content: {
        findFirst: vi.fn().mockResolvedValue({ thumbnailUrl: priorUrl }),
      },
      users: { findFirst: vi.fn().mockResolvedValue({ avatarUrl: null }) },
    },
  };
  return { db: db as unknown as Database, update: db.update };
}

/** A 4-byte JPEG so `validateImageFile`'s magic-byte check passes. */
function createTestImageFile(): File {
  const bytes = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...new Array(100).fill(0),
  ]);
  return new File([bytes], 'test.jpg', { type: 'image/jpeg' });
}

function serviceFor(bucket: ReturnType<typeof createBucket>, db: Database) {
  return new ImageProcessingService({
    db,
    environment: 'test',
    r2Service: bucket.r2,
    r2PublicUrlBase: R2_BASE,
  });
}

describe('Codex-r85jo.2: a partial upload preserves the previous image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processor.processStillVariants).mockReturnValue({
      variants: {
        sm: new Uint8Array([1]),
        md: new Uint8Array([2, 2]),
        lg: new Uint8Array([3, 3, 3]),
        xl: new Uint8Array([4, 4, 4, 4]),
      },
      width: 1200,
      height: 800,
    });
  });

  for (const [label, priorFolder] of [
    ['a legacy fixed-key image', LEGACY_FOLDER],
    ['a sized-folder image', PRIOR_FOLDER],
  ] as const) {
    it(`leaves ${label} readable and removes what landed when one put rejects`, async () => {
      const bucket = createBucket(priorFolder, { rejectNewPut: 'md' });
      const { db, update } = createDb(
        `${R2_BASE}/${priorFolder}/lg.webp`,
        'passes'
      );

      await expect(
        serviceFor(bucket, db).processContentThumbnail(
          CONTENT_ID,
          CREATOR_ID,
          createTestImageFile()
        )
      ).rejects.toThrow();

      // The failure really is a PARTIAL upload: all four puts were attempted.
      // Without this, a throw before any put would pass every check below.
      expect(bucket.put).toHaveBeenCalledTimes(4);

      // THE assertion: nothing the row addresses 404s, and none of it changed.
      for (const key of bucket.priorKeys) {
        expect(bucket.objects.get(key), key).toBe(PRIOR);
      }
      // And the three files that did land are gone, not leaked.
      expect(bucket.newKeys()).toEqual([]);
      // The row was never moved off the previous image.
      expect(update).not.toHaveBeenCalled();
    });
  }

  it('never deletes a key the previous image occupies', async () => {
    const bucket = createBucket(PRIOR_FOLDER, { rejectNewPut: 'xl' });
    const { db } = createDb(`${R2_BASE}/${PRIOR_FOLDER}/lg.webp`, 'passes');

    await expect(
      serviceFor(bucket, db).processContentThumbnail(
        CONTENT_ID,
        CREATOR_ID,
        createTestImageFile()
      )
    ).rejects.toThrow();

    const deleted = bucket.delete.mock.calls.map((call) => call[0]);
    expect(deleted).toHaveLength(4);
    expect(deleted.filter((key) => bucket.priorKeys.includes(key))).toEqual([]);
  });

  it('reports an R2 failure as a 500, not as a client validation error', async () => {
    const bucket = createBucket(LEGACY_FOLDER, { rejectNewPut: 'md' });
    const { db } = createDb(null, 'passes');

    // Asserted by `code`/`statusCode`, never by class name: class names
    // minify in the worker bundle, so an `instanceof`/name assertion passes
    // locally and goes vacuous in production.
    const error = await serviceFor(bucket, db)
      .processContentThumbnail(CONTENT_ID, CREATOR_ID, createTestImageFile())
      .then(() => null)
      .catch((e: unknown) => e as { code?: string; statusCode?: number });

    expect(error?.statusCode).toBe(500);
    expect(error?.code).toBe('INTERNAL_ERROR');
  });

  it('names the failed variant in the error without leaking R2 internals', async () => {
    const bucket = createBucket(LEGACY_FOLDER, { rejectNewPut: 'md' });
    const { db } = createDb(null, 'passes');

    const error = await serviceFor(bucket, db)
      .processContentThumbnail(CONTENT_ID, CREATOR_ID, createTestImageFile())
      .then(() => null)
      .catch(
        (e: unknown) => e as Error & { context?: Record<string, unknown> }
      );

    // `mapErrorToResponse` assigns `details: error.context` VERBATIM into the
    // response body (error-mapper.ts), so the error object is a client-facing
    // surface. The variant is named; the R2 rejection reason is not.
    expect(error?.message).toMatch(/md/);
    const serialised = JSON.stringify({
      message: error?.message,
      context: error?.context,
    });
    expect(serialised).not.toMatch(/R2 transient failure/);
    expect(serialised).not.toMatch(/content-thumbnails/);
  });

  describe('the row write decides which folder goes', () => {
    it('a FAILED write deletes the new folder and keeps the previous image', async () => {
      const bucket = createBucket(PRIOR_FOLDER);
      const { db } = createDb(`${R2_BASE}/${PRIOR_FOLDER}/lg.webp`, 'fails');

      await expect(
        serviceFor(bucket, db).processContentThumbnail(
          CONTENT_ID,
          CREATOR_ID,
          createTestImageFile()
        )
      ).rejects.toThrow(/Database connection lost/i);

      // All four new files go, xl included, or they leak (Codex-kk9nv.5).
      expect(bucket.delete).toHaveBeenCalledTimes(4);
      expect(bucket.newKeys()).toEqual([]);
      for (const key of bucket.priorKeys) {
        expect(bucket.objects.get(key), key).toBe(PRIOR);
      }
    });

    it('a SUCCESSFUL write deletes the previous image and keeps the new one', async () => {
      const bucket = createBucket(LEGACY_FOLDER);
      const { db } = createDb(`${R2_BASE}/${LEGACY_FOLDER}/lg.webp`, 'passes');

      const result = await serviceFor(bucket, db).processContentThumbnail(
        CONTENT_ID,
        CREATOR_ID,
        createTestImageFile()
      );

      // "Inline, same request": the replaced folder is gone once the call
      // returns, and the URL handed back is one of the files still present.
      for (const key of bucket.priorKeys) {
        expect(bucket.objects.has(key), key).toBe(false);
      }
      expect(bucket.newKeys()).toHaveLength(4);
      expect(bucket.objects.has(result.url.slice(R2_BASE.length + 1))).toBe(
        true
      );
    });

    it('CALIBRATION: the bucket model detects a delete', async () => {
      // Without this, a stubbed-out `delete` that never touches the Map would
      // make every "key is still readable" assertion above pass vacuously.
      const bucket = createBucket(LEGACY_FOLDER);
      const [first, second] = bucket.priorKeys;
      await bucket.r2.delete(first ?? '');
      expect(bucket.objects.has(first ?? '')).toBe(false);
      expect(bucket.objects.has(second ?? '')).toBe(true);
    });
  });
});
