/**
 * Codex-r85jo.2 — a partial image upload must not DELETE the previous image.
 *
 * ## The bug this proves is gone
 *
 * `uploadImageVariants` used to run a compensating `delete` of ALL THREE
 * variant keys whenever ANY of the three puts rejected. That was written under
 * a premise `Codex-p3rre` retired: the old docblock claimed "variants get
 * unique filenames per upload", and under unique keys deleting all three is a
 * correct rollback of objects that were just created and are referenced by
 * nothing.
 *
 * The keys are DETERMINISTIC — `getContentThumbnailKey(creatorId, contentId,
 * size)` is a pure function with no nonce, hash or timestamp — so the keys the
 * "rollback" deleted are the keys the DB row ALREADY points at. And
 * `uploadImageVariants` runs BEFORE the DB write, so the throw skips the
 * update and the row keeps addressing objects that no longer exist.
 *
 * ## Why NO deletion subset is correct
 *
 * R2 `put` is atomic per object, so after a partial failure every key is in
 * exactly one state:
 *
 *   | key            | prior bytes            | new bytes |
 *   |----------------|------------------------|-----------|
 *   | put SUCCEEDED  | gone (overwritten)     | present   |
 *   | put REJECTED   | INTACT                 | absent    |
 *
 * Deleting a REJECTED key destroys an intact previous variant — it targets
 * precisely the objects still worth keeping. Deleting a SUCCEEDED key leaves
 * the key empty. So "delete only the keys that rejected" is the WORST option,
 * not the safe one, and the correct behaviour is to delete NOTHING and let the
 * deterministic keys self-heal on retry.
 *
 * ## What these tests assert
 *
 * The bucket is modelled as a `Map`, seeded with a previous image at all three
 * keys, so the assertion is the acceptance criterion's own wording — every
 * variant key the previous image occupied is still READABLE — rather than the
 * weaker "delete was not called".
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../../processor';
import { ImageProcessingService } from '../../service';

vi.mock('../../processor', () => ({
  processImageVariants: vi.fn(),
}));

const R2_BASE = 'https://test.r2.dev';
const CONTENT_ID = 'content-1';
const CREATOR_ID = 'user-1';

const KEYS = {
  sm: `${CREATOR_ID}/content-thumbnails/${CONTENT_ID}/sm.webp`,
  md: `${CREATOR_ID}/content-thumbnails/${CONTENT_ID}/md.webp`,
  lg: `${CREATOR_ID}/content-thumbnails/${CONTENT_ID}/lg.webp`,
} as const;

/** Bytes standing in for the image that is already live in the bucket. */
const PRIOR = 'PREVIOUS-IMAGE-BYTES';

/**
 * A minimal R2 stand-in backed by a Map, so a test can ask the question that
 * actually matters — "is this key still readable?" — instead of inspecting
 * which methods were called.
 *
 * `rejectPutFor` names the ONE key whose put fails, which is the mid-sequence
 * transient failure (a 500, a quota rejection) the bug reacts to.
 */
function createBucket(options: { rejectPutFor?: string } = {}) {
  const objects = new Map<string, string>([
    [KEYS.sm, PRIOR],
    [KEYS.md, PRIOR],
    [KEYS.lg, PRIOR],
  ]);

  const put = vi.fn(async (key: string, body: Uint8Array) => {
    if (key === options.rejectPutFor) {
      throw new Error('R2 transient failure: 500');
    }
    objects.set(key, `NEW-${body.byteLength}`);
  });

  const del = vi.fn(async (key: string) => {
    objects.delete(key);
  });

  return {
    objects,
    put,
    delete: del,
    r2: { put, delete: del } as unknown as R2Service,
  };
}

/** A DB whose `update` rejects, to drive the `withDbUpdateOrphanCleanup` path. */
function createFailingUpdateDb(priorThumbnailUrl: string | null): Database {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('Database connection lost')),
      }),
    }),
    query: {
      content: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ thumbnailUrl: priorThumbnailUrl }),
      },
      users: { findFirst: vi.fn().mockResolvedValue({ avatarUrl: null }) },
    },
  } as unknown as Database;
}

function createPassingDb(priorThumbnailUrl: string | null): Database {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: CONTENT_ID }]),
      }),
    }),
    query: {
      content: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ thumbnailUrl: priorThumbnailUrl }),
      },
      users: { findFirst: vi.fn().mockResolvedValue({ avatarUrl: null }) },
    },
  } as unknown as Database;
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

describe('Codex-r85jo.2: a partial upload preserves the previous image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(processor.processImageVariants).mockReturnValue({
      sm: new Uint8Array([1]),
      md: new Uint8Array([2, 2]),
      lg: new Uint8Array([3, 3, 3]),
    });
  });

  it('leaves every previously-occupied variant key readable when one put rejects', async () => {
    const bucket = createBucket({ rejectPutFor: KEYS.md });
    const service = new ImageProcessingService({
      db: createPassingDb(`${R2_BASE}/${KEYS.lg}`),
      environment: 'test',
      r2Service: bucket.r2,
      r2PublicUrlBase: R2_BASE,
    });

    await expect(
      service.processContentThumbnail(
        CONTENT_ID,
        CREATOR_ID,
        createTestImageFile()
      )
    ).rejects.toThrow();

    // THE assertion: nothing 404s. sm and lg hold the new bytes, md still
    // holds the previous image because its put never landed.
    expect(bucket.objects.has(KEYS.sm)).toBe(true);
    expect(bucket.objects.has(KEYS.md)).toBe(true);
    expect(bucket.objects.has(KEYS.lg)).toBe(true);
    expect(bucket.objects.get(KEYS.md)).toBe(PRIOR);
  });

  it('does not delete anything on a partial upload failure', async () => {
    const bucket = createBucket({ rejectPutFor: KEYS.md });
    const service = new ImageProcessingService({
      db: createPassingDb(`${R2_BASE}/${KEYS.lg}`),
      environment: 'test',
      r2Service: bucket.r2,
      r2PublicUrlBase: R2_BASE,
    });

    await expect(
      service.processContentThumbnail(
        CONTENT_ID,
        CREATOR_ID,
        createTestImageFile()
      )
    ).rejects.toThrow();

    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('reports an R2 failure as a 500, not as a client validation error', async () => {
    const bucket = createBucket({ rejectPutFor: KEYS.md });
    const service = new ImageProcessingService({
      db: createPassingDb(null),
      environment: 'test',
      r2Service: bucket.r2,
      r2PublicUrlBase: R2_BASE,
    });

    // Asserted by `code`/`statusCode`, never by class name: class names
    // minify in the worker bundle, so an `instanceof`/name assertion passes
    // locally and goes vacuous in production.
    const error = await service
      .processContentThumbnail(CONTENT_ID, CREATOR_ID, createTestImageFile())
      .then(() => null)
      .catch((e: unknown) => e as { code?: string; statusCode?: number });

    expect(error?.statusCode).toBe(500);
    expect(error?.code).toBe('INTERNAL_ERROR');
  });

  it('names the failed variant in the error without leaking R2 internals', async () => {
    const bucket = createBucket({ rejectPutFor: KEYS.md });
    const service = new ImageProcessingService({
      db: createPassingDb(null),
      environment: 'test',
      r2Service: bucket.r2,
      r2PublicUrlBase: R2_BASE,
    });

    const error = await service
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

  describe('the DB-failure cleanup splits on whether the keys were referenced', () => {
    it('does NOT delete on a REPLACEMENT — the row still addresses these keys', async () => {
      const bucket = createBucket();
      const service = new ImageProcessingService({
        // Prior URL is exactly the URL this upload would write, so the row
        // already addresses these keys and deleting them 404s a live image.
        db: createFailingUpdateDb(`${R2_BASE}/${KEYS.lg}`),
        environment: 'test',
        r2Service: bucket.r2,
        r2PublicUrlBase: R2_BASE,
      });

      await expect(
        service.processContentThumbnail(
          CONTENT_ID,
          CREATOR_ID,
          createTestImageFile()
        )
      ).rejects.toThrow(/Database connection lost/i);

      expect(bucket.delete).not.toHaveBeenCalled();
      expect(bucket.objects.has(KEYS.lg)).toBe(true);
    });

    it('DOES delete on a FIRST upload — nothing references the new keys', async () => {
      const bucket = createBucket();
      const service = new ImageProcessingService({
        db: createFailingUpdateDb(null),
        environment: 'test',
        r2Service: bucket.r2,
        r2PublicUrlBase: R2_BASE,
      });

      await expect(
        service.processContentThumbnail(
          CONTENT_ID,
          CREATOR_ID,
          createTestImageFile()
        )
      ).rejects.toThrow(/Database connection lost/i);

      // This is the one case the compensating delete is FOR: the puts landed,
      // the DB never recorded them, so the objects are genuine orphans.
      expect(bucket.delete).toHaveBeenCalledTimes(3);
    });

    it('CALIBRATION: the bucket model detects a delete', async () => {
      // Without this, a stubbed-out `delete` that never touches the Map would
      // make every "key is still readable" assertion above pass vacuously.
      const bucket = createBucket();
      await bucket.r2.delete(KEYS.md);
      expect(bucket.objects.has(KEYS.md)).toBe(false);
      expect(bucket.objects.has(KEYS.sm)).toBe(true);
    });
  });
});
