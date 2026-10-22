/**
 * Cache-Control invariant for every object this package writes (Codex-p3rre,
 * Codex-kk9nv.5).
 *
 * THE INVARIANT: a key may tell a cache it need never ask again ONLY if the
 * bytes at that key never change.
 *
 * Until kk9nv.5 every still was keyed by entity id and size alone, so a
 * re-upload wrote NEW BYTES AT THE SAME URL and `immutable` served a replaced
 * image for up to a year (Codex-p3rre); the header was the revalidating
 * `R2_OVERWRITTEN_OBJECT_CACHE_CONTROL`. This file used to end with a control
 * test saying "If keys ever became unique per upload, `immutable` would be
 * defensible and this test would fail first". They did: each upload now writes
 * a new `{base}/{w}x{h}-{8 hex}` folder, and a page image a fresh uuid, so the
 * owner chose "Cache forever" (2026-10-21).
 *
 * SO THESE TESTS ASSERT BOTH HALVES. The PREMISE: two uploads of one entity
 * share no key. The PROPERTY: each object's `cacheControl`, as `R2Service.put`
 * receives it, is `immutable` with a long window. If keys ever became
 * deterministic again, the premise test fails first and points here.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import { readStillFolderName } from '@codex/validation';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../processor';
import { ImageProcessingService } from '../service';

vi.mock('../processor', () => ({
  processStillVariants: vi.fn(),
}));

/** Thirty days, in seconds — the shortest window "cache forever" tolerates. */
const MAX_AGE_FLOOR_SECONDS = 30 * 86_400;

/** The numeric argument of a directive, or undefined when it is absent. */
function directiveSeconds(value: string, name: string): number | undefined {
  for (const part of value.split(',')) {
    const [key, arg] = part.trim().split('=');
    if (key?.trim() === name) return Number(arg);
  }
  return undefined;
}

/** Assert the property on one `Cache-Control` value. */
function expectCachedForever(cacheControl: string, key: string): void {
  const found = cacheControl.split(',').map((part) => part.trim());
  expect(found, `${key}: not immutable`).toContain('immutable');
  expect(found, `${key}: not public`).toContain('public');
  expect(
    directiveSeconds(cacheControl, 'max-age'),
    `${key}: max-age`
  ).toBeGreaterThanOrEqual(MAX_AGE_FLOOR_SECONDS);
}

describe('Cache-Control on fresh image keys (Codex-p3rre, Codex-kk9nv.5)', () => {
  let service: ImageProcessingService;
  let r2: { put: Mock; delete: Mock };

  /** Every (key, cacheControl) pair handed to `R2Service.put` so far. */
  function putHeaders(): { key: string; cacheControl: string }[] {
    return r2.put.mock.calls.map((call) => {
      const [key, , , httpMetadata] = call as [
        string,
        unknown,
        unknown,
        { cacheControl?: string } | undefined,
      ];
      return { key, cacheControl: httpMetadata?.cacheControl ?? '' };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();

    r2 = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const db = {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          // Awaited, the matched rows; `.returning()` resolves them too.
          where: vi.fn(() =>
            Object.assign(Promise.resolve([{ id: 'row-1' }]), {
              returning: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
            })
          ),
        }),
      }),
      // The thumbnail and avatar paths read the row's current image URL to
      // find the folder they replace. These cases replace nothing.
      query: {
        content: {
          findFirst: vi.fn().mockResolvedValue({ thumbnailUrl: null }),
        },
        users: { findFirst: vi.fn().mockResolvedValue({ avatarUrl: null }) },
      },
    } as unknown as Database;

    service = new ImageProcessingService({
      db,
      environment: 'test',
      r2Service: r2 as unknown as R2Service,
      r2PublicUrlBase: 'https://test.r2.dev',
    });

    vi.mocked(processor.processStillVariants).mockReturnValue({
      variants: {
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
        xl: new Uint8Array([4]),
      },
      width: 1200,
      height: 800,
    });
  });

  /**
   * Assert the four objects one upload wrote are sm/md/lg/xl in ONE new
   * folder under `base`, named for the picture's size, and return the folder.
   */
  function expectOneNewFolder(keys: string[], base: string): string {
    expect(keys).toHaveLength(4);
    const folder = keys[0]?.replace(/\/sm\.webp$/, '') ?? '';
    expect(keys).toEqual([
      `${folder}/sm.webp`,
      `${folder}/md.webp`,
      `${folder}/lg.webp`,
      `${folder}/xl.webp`,
    ]);
    expect(folder.startsWith(`${base}/`)).toBe(true);
    expect(readStillFolderName(folder.slice(base.length + 1))).toEqual({
      width: 1200,
      height: 800,
    });
    return folder;
  }

  /** A minimal but signature-valid PNG — magic bytes are verified upstream. */
  function pngFile(): File {
    const bytes = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...new Array(64).fill(0),
    ]);
    return new File([bytes], 'image.png', { type: 'image/png' });
  }

  it('content thumbnail files are a new folder, cached forever', async () => {
    await service.processContentThumbnail('content-1', 'user-1', pngFile());

    const headers = putHeaders();
    expectOneNewFolder(
      headers.map((h) => h.key),
      'user-1/content-thumbnails/content-1'
    );
    for (const { key, cacheControl } of headers) {
      expectCachedForever(cacheControl, key);
    }
  });

  it('avatar files are a new folder, cached forever', async () => {
    await service.processUserAvatar('user-1', pngFile());

    const headers = putHeaders();
    expectOneNewFolder(
      headers.map((h) => h.key),
      'avatars/user-1'
    );
    for (const { key, cacheControl } of headers) {
      expectCachedForever(cacheControl, key);
    }
  });

  it('category cover files are a new folder, cached forever', async () => {
    const result = await service.processCategoryCover('cat-1', pngFile());

    const headers = putHeaders();
    const folder = expectOneNewFolder(
      headers.map((h) => h.key),
      'categories/cat-1/cover'
    );
    expect(result.coverImageKey).toBe(folder);
    for (const { key, cacheControl } of headers) {
      expectCachedForever(cacheControl, key);
    }
  });

  it('course hero files are a new folder, cached forever', async () => {
    const result = await service.processCourseHero('course-1', pngFile());

    const headers = putHeaders();
    const folder = expectOneNewFolder(
      headers.map((h) => h.key),
      'courses/course-1/hero'
    );
    expect(result.heroImageKey).toBe(folder);
    for (const { key, cacheControl } of headers) {
      expectCachedForever(cacheControl, key);
    }
  });

  it('page image files are cached forever (a fresh uuid per upload)', async () => {
    await service.processPageImage('page-1', 'image-1', pngFile());

    const headers = putHeaders();
    expect(headers).toHaveLength(4);
    for (const { key, cacheControl } of headers) {
      expectCachedForever(cacheControl, key);
    }
  });

  it('re-uploading shares no key with the first upload — the premise the invariant rests on', async () => {
    // Not a cache assertion: the CONTROL that makes the ones above safe. If
    // keys ever became deterministic again, `immutable` would serve a replaced
    // image for a year, and this test fails first.
    await service.processContentThumbnail('content-1', 'user-1', pngFile());
    const first = putHeaders().map((h) => h.key);

    r2.put.mockClear();
    await service.processContentThumbnail('content-1', 'user-1', pngFile());
    const second = putHeaders().map((h) => h.key);

    expect(second.filter((key) => first.includes(key))).toEqual([]);
  });
});
