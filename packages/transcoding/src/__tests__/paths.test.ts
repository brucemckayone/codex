import { describe, expect, it } from 'vitest';
import {
  B2_PATH_CONFIG,
  getContentThumbnailKey,
  getHlsMasterKey,
  getHlsPreviewKey,
  getHlsVariantKey,
  getHlsVariantSegmentKey,
  getMediaThumbnailKey,
  getMediaThumbnailUrl,
  getMezzanineKey,
  getMezzaninePrefix,
  getOrgLogoKey,
  getOriginalKey,
  getThumbnailKey,
  getUserAvatarKey,
  getWaveformKey,
  isValidR2Key,
  PATH_CONFIG,
  parseR2Key,
} from '../paths';

describe('Path Helpers', () => {
  const creatorId = 'user_123';
  const mediaId = '550e8400-e29b-41d4-a716-446655440000';

  describe('R2 Key Generation', () => {
    it('getOriginalKey should return correct format', () => {
      const key = getOriginalKey(creatorId, mediaId, 'video.mp4');
      expect(key).toBe(`${creatorId}/originals/${mediaId}/video.mp4`);
    });

    it('getHlsMasterKey should return correct format', () => {
      const key = getHlsMasterKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/hls/${mediaId}/master.m3u8`);
    });

    it('getHlsPreviewKey should return correct format', () => {
      const key = getHlsPreviewKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/hls/${mediaId}/preview/preview.m3u8`);
    });

    it('getHlsVariantKey should return correct format', () => {
      const key = getHlsVariantKey(creatorId, mediaId, '1080p');
      expect(key).toBe(`${creatorId}/hls/${mediaId}/1080p/index.m3u8`);
    });

    it('getHlsVariantSegmentKey should return correct format', () => {
      const key = getHlsVariantSegmentKey(
        creatorId,
        mediaId,
        '1080p',
        'segment_000.ts'
      );
      expect(key).toBe(`${creatorId}/hls/${mediaId}/1080p/segment_000.ts`);
    });

    it('getThumbnailKey should return correct format', () => {
      const key = getThumbnailKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/thumbnails/${mediaId}/auto-generated.jpg`);
    });

    it('getWaveformKey should return correct format', () => {
      const key = getWaveformKey(creatorId, mediaId);
      expect(key).toBe(`${creatorId}/waveforms/${mediaId}/waveform.json`);
    });

    it('getContentThumbnailKey should return correct format', () => {
      const key = getContentThumbnailKey(creatorId, 'content-123', 'md');
      expect(key).toBe(`${creatorId}/content-thumbnails/content-123/md.webp`);
    });

    it('getOrgLogoKey should return correct format', () => {
      const key = getOrgLogoKey(creatorId, 'lg');
      expect(key).toBe(`${creatorId}/branding/logo/lg.webp`);
    });

    it('getUserAvatarKey should return correct format', () => {
      const key = getUserAvatarKey('user-456', 'sm');
      expect(key).toBe(`avatars/user-456/sm.webp`);
    });

    it('getMediaThumbnailKey should generate correct WebP path for each size', () => {
      expect(getMediaThumbnailKey(creatorId, mediaId, 'sm')).toBe(
        `${creatorId}/media-thumbnails/${mediaId}/sm.webp`
      );
      expect(getMediaThumbnailKey(creatorId, mediaId, 'md')).toBe(
        `${creatorId}/media-thumbnails/${mediaId}/md.webp`
      );
      expect(getMediaThumbnailKey(creatorId, mediaId, 'lg')).toBe(
        `${creatorId}/media-thumbnails/${mediaId}/lg.webp`
      );
    });

    it('getMediaThumbnailUrl should generate correct CDN URL', () => {
      const url = getMediaThumbnailUrl(
        creatorId,
        mediaId,
        'md',
        'https://cdn-assets.revelations.studio'
      );
      expect(url).toBe(
        `https://cdn-assets.revelations.studio/${creatorId}/media-thumbnails/${mediaId}/md.webp`
      );
    });

    it('getMediaThumbnailUrl should work with any CDN base', () => {
      const url = getMediaThumbnailUrl(
        creatorId,
        mediaId,
        'lg',
        'https://custom-cdn.example.com'
      );
      expect(url).toBe(
        `https://custom-cdn.example.com/${creatorId}/media-thumbnails/${mediaId}/lg.webp`
      );
    });

    it('getMediaThumbnailUrl should handle trailing slash in CDN base', () => {
      const url = getMediaThumbnailUrl(
        creatorId,
        mediaId,
        'sm',
        'https://cdn.example.com/' // Note trailing slash
      );
      expect(url).toBe(
        `https://cdn.example.com/${creatorId}/media-thumbnails/${mediaId}/sm.webp`
      );
    });
  });

  describe('B2 Key Generation', () => {
    it('getMezzanineKey should return correct format', () => {
      const key = getMezzanineKey(creatorId, mediaId);
      expect(key).toBe(
        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/${B2_PATH_CONFIG.MEZZANINE_FILENAME}`
      );
      // Double check exact string to ensure config wasn't accidentally changed
      expect(key).toBe(`${creatorId}/mezzanine/${mediaId}/mezzanine.mp4`);
    });

    it('getMezzaninePrefix should return correct format', () => {
      const prefix = getMezzaninePrefix(creatorId, mediaId);
      expect(prefix).toBe(
        `${creatorId}/${B2_PATH_CONFIG.MEZZANINE_FOLDER}/${mediaId}/`
      );
    });
  });

  describe('R2 Key Parsing and Validation', () => {
    it('isValidR2Key should return true for valid keys', () => {
      const validKey = `${creatorId}/originals/${mediaId}/video.mp4`;
      expect(isValidR2Key(validKey)).toBe(true);
    });

    // isValidR2Key only validates format, not ownership against a creatorId argument
    it('isValidR2Key should return true for valid key structure regardless of creator', () => {
      const otherCreatorKey = `other_user/originals/${mediaId}/video.mp4`;
      expect(isValidR2Key(otherCreatorKey)).toBe(true);
    });

    it('isValidR2Key should return false for malformed keys', () => {
      expect(isValidR2Key('invalid-key')).toBe(false);
      expect(isValidR2Key(`${creatorId}/foo`)).toBe(false); // Too short
    });

    it('parseR2Key should extract components correctly', () => {
      const key = `${creatorId}/originals/${mediaId}/video.mp4`;
      const result = parseR2Key(key);
      expect(result).toEqual({
        creatorId,
        folder: 'originals',
        mediaId,
        filename: 'video.mp4',
      });
    });

    it('parseR2Key should return null for invalid keys', () => {
      expect(parseR2Key('invalid-key')).toBeNull();
    });
  });

  describe('Path Traversal Protection', () => {
    it('isValidR2Key should reject path traversal attempts', () => {
      expect(isValidR2Key('../../../etc/passwd')).toBe(false);
      expect(isValidR2Key('user/../admin/file.mp4')).toBe(false);
      expect(isValidR2Key('user/originals/../../../secret')).toBe(false);
    });

    it('isValidR2Key should reject URL-encoded traversal', () => {
      expect(isValidR2Key('user%2f..%2f..%2fetc/passwd')).toBe(false);
      expect(isValidR2Key('%2e%2e/admin')).toBe(false);
    });

    it('isValidR2Key should reject null bytes', () => {
      expect(isValidR2Key('user/file%00.mp4')).toBe(false);
    });

    it('isValidR2Key should reject backslash paths', () => {
      expect(isValidR2Key('user\\..\\admin')).toBe(false);
    });
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PUBLIC-EXPOSURE PIN
 *
 * `apps/web/src/lib/server/cdn-proxy.ts` binds the OTHERWISE-PRIVATE production
 * media bucket and serves an object from it — publicly, with no signature —
 * whenever a key matches this shape:
 *
 *     /^[^/]+\/hls\/[^/]+\/preview\//
 *
 * That gate is the ONLY thing separating the free-taste clip from every paid
 * rendition and every creator's original upload in the same bucket. It is
 * fail-closed by construction (the binding is only obtained when the gate
 * passes) and it is tested there against traversal, case-flips and
 * prefix-adjacent names.
 *
 * BUT THE GATE HARDCODES A LAYOUT THIS FILE OWNS, and nothing else connects the
 * two. `apps/web` does not depend on `@codex/transcoding`, so it cannot import
 * `PATH_CONFIG` — the regex is a restatement. That is the hazard this block
 * exists for: if the preview layout below ever moves, the gate silently stops
 * matching (previews 404, a visible failure) — but worse, if anything sensitive
 * is ever written UNDER a `…/hls/…/preview/` prefix, it becomes publicly
 * readable, and that change would look entirely innocent in its own PR.
 *
 * So: do not "fix" a failure here by widening the regex in cdn-proxy.ts.
 * Decide, deliberately, what is public.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('HLS preview layout — pinned against the public CDN gate', () => {
  /** Restated from `isPublicMediaPreviewKey` in apps/web/src/lib/server/cdn-proxy.ts. */
  const PUBLIC_CDN_GATE = /^[^/]+\/hls\/[^/]+\/preview\//;

  it('produces a preview key the public gate matches', () => {
    const key = getHlsPreviewKey('creator-1', 'media-1');
    expect(key).toMatch(PUBLIC_CDN_GATE);
  });

  it('keeps every OTHER rendition outside the gate', () => {
    // The paid renditions and the master playlist share this bucket. If any of
    // them starts matching, it becomes world-readable.
    const mustNotBePublic = [
      getHlsMasterKey('creator-1', 'media-1'),
      getHlsVariantKey('creator-1', 'media-1', '1080p'),
      getHlsVariantSegmentKey(
        'creator-1',
        'media-1',
        '1080p',
        'segment_000.ts'
      ),
    ];
    for (const key of mustNotBePublic) {
      expect(key, `${key} would be served publicly`).not.toMatch(
        PUBLIC_CDN_GATE
      );
    }
  });

  it('pins the subfolder name the gate hardcodes', () => {
    // A rename here is a public-surface change, not a refactor.
    expect(PATH_CONFIG.HLS_PREVIEW_SUBFOLDER).toBe('preview');
    expect(PATH_CONFIG.HLS_FOLDER).toBe('hls');
  });
});
