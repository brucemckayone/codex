/**
 * Cache-Control invariant for every object this package writes (Codex-p3rre).
 *
 * THE INVARIANT: a key that is OVERWRITTEN IN PLACE may not tell a cache it
 * need not ask about it again.
 *
 * Every key builder reachable from `ImageProcessingService` is a pure function
 * of an entity id and a size — `getContentThumbnailKey`, `getUserAvatarKey`,
 * `getOrgLogoKey`, and the inline `categories/{id}/cover/{size}.webp` and
 * `courses/{id}/{cover,hero,signature}/{size}.webp`. There is no timestamp, no
 * uuid and no content hash anywhere in the package, and the public URL is
 * `${r2PublicUrlBase}/${key}` with no version query string. Re-uploading
 * therefore writes NEW BYTES AT THE SAME URL.
 *
 * The header used to be `public, max-age=31536000, immutable`, on a docblock
 * claiming "variants get unique filenames per upload" — the opposite of what
 * the builders do. Under RFC 8246 `immutable` instructs a cache not to
 * revalidate for the freshness window at all, not even on a user-initiated
 * reload, so a replaced image served the OLD bytes for up to a year with no
 * purge path. Nothing failed, because nothing asserted on the header's
 * MEANING — only on its exact text, in two places, which a future edit would
 * simply have updated in lockstep.
 *
 * SO THESE TESTS ASSERT THE PROPERTY, NOT THE STRING. They read the
 * `cacheControl` that `R2Service.put` actually receives (the value that ends
 * up on the object, and thus in the response R2's custom domain serves) and
 * check the three things that make it safe on a mutable key: no `immutable`,
 * a revalidation directive, and a bounded window. A future change that
 * restored a year-long unrevalidatable window on a deterministic key fails
 * here whatever text it is spelled with.
 *
 * `max-age` ceiling: one day. The chosen value is 3600s — matching
 * `CACHE_PRESETS.asset`'s browser window and the production assets bucket's
 * declared `browserTtl` — and the ceiling is deliberately looser than the
 * choice so that tuning the window is not a test edit while restoring the
 * defect still is.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../processor';
import { ImageProcessingService } from '../service';

vi.mock('../processor', () => ({
  processImageVariants: vi.fn(),
}));

/** One day, in seconds — the loosest window this invariant tolerates. */
const MAX_AGE_CEILING_SECONDS = 86_400;

/** Lower-cased directive names present in a `Cache-Control` value. */
function directives(value: string): string[] {
  return value.split(',').map((part) => part.trim().split('=')[0] ?? '');
}

/** The numeric argument of a directive, or undefined when it is absent. */
function directiveSeconds(value: string, name: string): number | undefined {
  for (const part of value.split(',')) {
    const [key, arg] = part.trim().split('=');
    if (key?.trim() === name) return Number(arg);
  }
  return undefined;
}

/**
 * Assert the invariant on one `Cache-Control` value.
 *
 * Split out rather than inlined so the failure message names the key whose
 * header is wrong, and so a new upload method is one `it` block away from
 * being covered.
 */
function expectSafeOnAMutableKey(cacheControl: string, key: string): void {
  const found = directives(cacheControl);

  // The defect itself: `immutable` forbids revalidation outright, so a
  // replaced image is unreachable for the whole window.
  expect(found, `${key}: immutable on a deterministic key`).not.toContain(
    'immutable'
  );

  // Something must oblige a cache to ask again. `must-revalidate` (may not
  // serve stale past freshness) or `no-cache` (must revalidate before any
  // reuse) both satisfy this; either is a live revalidation path to R2, which
  // answers a conditional GET with a 304.
  const revalidates =
    found.includes('must-revalidate') ||
    found.includes('no-cache') ||
    found.includes('proxy-revalidate');
  expect(
    revalidates,
    `${key}: no revalidation directive in ${cacheControl}`
  ).toBe(true);

  // And the window itself must be bounded. Absent `max-age` is fine (that is
  // stricter, not looser); present-and-huge is the regression.
  const maxAge = directiveSeconds(cacheControl, 'max-age');
  if (maxAge !== undefined) {
    expect(maxAge, `${key}: max-age`).toBeLessThanOrEqual(
      MAX_AGE_CEILING_SECONDS
    );
  }

  // No shared-cache window may outlive the browser's here. `CACHE_PRESETS.asset`
  // licenses 24h at the edge on the strength of content-addressing ("the key
  // encodes the bytes"), which is exactly what these keys do NOT do.
  const sMaxAge = directiveSeconds(cacheControl, 's-maxage');
  if (sMaxAge !== undefined) {
    expect(sMaxAge, `${key}: s-maxage`).toBeLessThanOrEqual(
      maxAge ?? MAX_AGE_CEILING_SECONDS
    );
  }
}

describe('Cache-Control on deterministic image keys (Codex-p3rre)', () => {
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
          where: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
        }),
      }),
    } as unknown as Database;

    service = new ImageProcessingService({
      db,
      environment: 'test',
      r2Service: r2 as unknown as R2Service,
      r2PublicUrlBase: 'https://test.r2.dev',
    });

    vi.mocked(processor.processImageVariants).mockReturnValue({
      sm: new Uint8Array([1]),
      md: new Uint8Array([2]),
      lg: new Uint8Array([3]),
    });
  });

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

  it('content thumbnail variants are revalidatable, not immutable', async () => {
    await service.processContentThumbnail('content-1', 'user-1', pngFile());

    const headers = putHeaders();
    expect(headers).toHaveLength(3);
    for (const { key, cacheControl } of headers) {
      expectSafeOnAMutableKey(cacheControl, key);
    }
  });

  it('avatar variants are revalidatable, not immutable', async () => {
    await service.processUserAvatar('user-1', pngFile());

    const headers = putHeaders();
    expect(headers).toHaveLength(3);
    for (const { key, cacheControl } of headers) {
      expectSafeOnAMutableKey(cacheControl, key);
    }
  });

  it('category cover variants are revalidatable, not immutable', async () => {
    await service.processCategoryCover('cat-1', pngFile());

    const headers = putHeaders();
    expect(headers).toHaveLength(3);
    for (const { key, cacheControl } of headers) {
      expectSafeOnAMutableKey(cacheControl, key);
    }
  });

  it('course hero variants are revalidatable, not immutable', async () => {
    await service.processCourseHero('course-1', pngFile());

    const headers = putHeaders();
    expect(headers).toHaveLength(3);
    for (const { key, cacheControl } of headers) {
      expectSafeOnAMutableKey(cacheControl, key);
    }
  });

  it('re-uploading writes the same keys — the premise the invariant rests on', async () => {
    // Not a cache assertion: the CONTROL that makes the ones above necessary.
    // If keys ever became unique per upload, `immutable` would be defensible
    // and this test would fail first, pointing at the docblock to revisit.
    await service.processContentThumbnail('content-1', 'user-1', pngFile());
    const first = putHeaders().map((h) => h.key);

    r2.put.mockClear();
    await service.processContentThumbnail('content-1', 'user-1', pngFile());
    const second = putHeaders().map((h) => h.key);

    expect(second).toEqual(first);
  });
});
