/**
 * Platform-hosted image URL gate (Codex-8so68)
 *
 * `urlSchema` accepts ANY http(s) host, which let a direct API call point a
 * content thumbnail or an org logo at a third-party server — bypassing the
 * R2 + `@codex/image-processing` pipeline and making every viewer's browser
 * fetch that host (leaking their IP and referrer).
 *
 * These tests pin the RULE. Enforcement lives on the service write paths
 * (`ContentService.create/update`, `OrganizationService.create/update`),
 * because the allowed base is the per-environment `R2_PUBLIC_URL_BASE`
 * binding and a schema in this package cannot read worker bindings.
 *
 * The two base literals below mirror the `R2_PUBLIC_URL_BASE` values in
 * `workers/content-api/wrangler.jsonc` and
 * `workers/organization-api/wrangler.jsonc`. They are fixtures standing in
 * for a binding value, not production URLs.
 */

import { describe, expect, it } from 'vitest';
import { createContentSchema } from '../content/content-schemas';
import {
  createOrganizationSchema,
  createPlatformImageUrlSchema,
  urlSchema,
} from '../index';

const PROD_BASE = 'https://cdn-assets.revelations.studio';
const DEV_BASE = 'http://localhost:4100';

const prodSchema = createPlatformImageUrlSchema(PROD_BASE);
const devSchema = createPlatformImageUrlSchema(DEV_BASE);

describe('createPlatformImageUrlSchema', () => {
  describe('rejects externally-hosted images', () => {
    it('rejects an unrelated third-party host', () => {
      const result = prodSchema.safeParse(
        'https://evil.example.com/tracker.png'
      );
      expect(result.success).toBe(false);
    });

    it('rejects a host that merely has the CDN as a prefix', () => {
      // A naive `startsWith(base)` check accepts this and the browser fetches
      // evil.example.com — the exact leak this gate exists to stop.
      const result = prodSchema.safeParse(
        'https://cdn-assets.revelations.studio.evil.example.com/tracker.png'
      );
      expect(result.success).toBe(false);
    });

    it('rejects the CDN host smuggled into userinfo', () => {
      // `new URL(...)` resolves the host to evil.example.com.
      const result = prodSchema.safeParse(
        'https://cdn-assets.revelations.studio@evil.example.com/tracker.png'
      );
      expect(result.success).toBe(false);
    });

    it('rejects embedded credentials even on the real CDN host', () => {
      const result = prodSchema.safeParse(
        `https://user:pass@cdn-assets.revelations.studio/u1/c1/lg.webp`
      );
      expect(result.success).toBe(false);
    });

    it('rejects a port swap against the dev base', () => {
      expect(
        devSchema.safeParse('http://localhost:5100/u1/c1/lg.webp').success
      ).toBe(false);
    });

    it('rejects a scheme swap against the dev base', () => {
      expect(
        devSchema.safeParse('https://localhost:4100/u1/c1/lg.webp').success
      ).toBe(false);
    });

    it('rejects the bare base with no asset key', () => {
      expect(prodSchema.safeParse(PROD_BASE).success).toBe(false);
      expect(prodSchema.safeParse(`${PROD_BASE}/`).success).toBe(false);
    });

    it('still rejects non-http(s) protocols inherited from urlSchema', () => {
      expect(prodSchema.safeParse('javascript:alert(1)').success).toBe(false);
      expect(
        prodSchema.safeParse('data:image/png;base64,iVBORw0KGgo=').success
      ).toBe(false);
    });

    it('fails CLOSED when no base is configured', () => {
      // A platform-produced URL cannot exist without a configured base, so
      // "no base" must never mean "allow anything".
      for (const base of [undefined, null, '']) {
        const schema = createPlatformImageUrlSchema(base);
        expect(schema.safeParse(`${PROD_BASE}/u1/c1/lg.webp`).success).toBe(
          false
        );
        expect(schema.safeParse('https://evil.example.com/x.png').success).toBe(
          false
        );
      }
    });
  });

  describe('accepts platform-produced URLs', () => {
    it('accepts an ImageProcessingService content-thumbnail URL', () => {
      // `${r2PublicUrlBase}/${getContentThumbnailKey(creatorId, contentId, 'lg')}`
      const result = prodSchema.safeParse(
        `${PROD_BASE}/user-123/content-thumbnails/content-456/lg.webp`
      );
      expect(result.success).toBe(true);
    });

    it('accepts a transcoding media-thumbnail poster URL', () => {
      // `${cdnBase}/${getMediaThumbnailKey(creatorId, mediaId, 'lg')}`
      const result = prodSchema.safeParse(
        `${PROD_BASE}/user-123/media-thumbnails/media-456/lg.webp`
      );
      expect(result.success).toBe(true);
    });

    it('accepts the same keys against the local dev-cdn base', () => {
      expect(
        devSchema.safeParse(
          `${DEV_BASE}/user-123/content-thumbnails/content-456/lg.webp`
        ).success
      ).toBe(true);
      expect(
        devSchema.safeParse(
          `${DEV_BASE}/user-123/media-thumbnails/media-456/md.webp`
        ).success
      ).toBe(true);
    });

    it('tolerates a trailing slash on the configured base', () => {
      const schema = createPlatformImageUrlSchema(`${PROD_BASE}/`);
      expect(schema.safeParse(`${PROD_BASE}/u1/c1/lg.webp`).success).toBe(true);
    });

    it('scopes to the base path when the base carries one', () => {
      const schema = createPlatformImageUrlSchema(`${PROD_BASE}/assets`);
      expect(schema.safeParse(`${PROD_BASE}/assets/u1/lg.webp`).success).toBe(
        true
      );
      expect(schema.safeParse(`${PROD_BASE}/other/u1/lg.webp`).success).toBe(
        false
      );
    });
  });

  // --------------------------------------------------------------------------
  // CONTROLS — these pass before and after the fix. They pin what must NOT
  // change, not the new behaviour.
  // --------------------------------------------------------------------------
  describe('controls: unchanged behaviour', () => {
    it('urlSchema itself stays permissive (many non-image fields need it)', () => {
      expect(urlSchema.safeParse('https://evil.example.com/x').success).toBe(
        true
      );
    });

    it('websiteUrl still accepts an external URL', () => {
      const result = createOrganizationSchema.safeParse({
        name: 'Test Org',
        slug: 'test-org',
        websiteUrl: 'https://some-creator-site.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('logoUrl and thumbnailUrl still allow null and undefined', () => {
      expect(
        createOrganizationSchema.safeParse({
          name: 'Test Org',
          slug: 'test-org',
          logoUrl: null,
        }).success
      ).toBe(true);
      expect(
        createOrganizationSchema.safeParse({
          name: 'Test Org',
          slug: 'test-org',
        }).success
      ).toBe(true);

      const baseContent = {
        title: 'Test',
        slug: 'test',
        contentType: 'written' as const,
        // Required by createContentSchema's written-content refine.
        contentBody: 'Body text',
      };
      expect(
        createContentSchema.safeParse({ ...baseContent, thumbnailUrl: null })
          .success
      ).toBe(true);
      expect(createContentSchema.safeParse(baseContent).success).toBe(true);
    });
  });
});
