/**
 * Branding Settings Service Tests
 *
 * Tests for BrandingSettingsService covering:
 * - get() returns defaults when no row exists
 * - get() returns stored values
 * - update() creates via upsert
 * - update() partial updates work
 * - Logo upload/delete operations
 */

import type { R2Service } from '@codex/cloudflare-clients';
import { MIME_TYPES } from '@codex/constants';
import { schema } from '@codex/database';
import {
  createTestMediaItemInput,
  type Database,
  seedTestUsers,
  setupTestDatabase,
  teardownTestDatabase,
} from '@codex/test-utils';
import { DEFAULT_BRANDING } from '@codex/validation';
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
import { InvalidFileTypeError } from '../errors';
import { BrandingSettingsService } from '../services/branding-settings-service';

// Mock sanitizeSvgContent — replace the real DOMPurify-backed implementation
// with a deterministic stub. The job of these tests is to verify that
// uploadLogo CALLS sanitizeSvgContent when MIME is SVG; DOMPurify itself
// is tested in packages/validation/src/__tests__/svg-sanitization.test.ts.
vi.mock('@codex/validation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codex/validation')>();
  return {
    ...actual,
    sanitizeSvgContent: vi.fn(async (svgText: string): Promise<string> => {
      // Simulate stripping <script>...</script> and event handler attributes.
      // Matches the observable behaviour of DOMPurify for the tests below.
      return svgText
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
    }),
  };
});

/**
 * Helper to create valid image file data for testing
 * Uses real PNG/JPEG magic numbers for content validation
 */
function createValidImageBuffer(
  mimeType: string,
  sizeBytes = 1024
): ArrayBuffer {
  const buffer = new ArrayBuffer(sizeBytes);
  const view = new Uint8Array(buffer);

  // Add magic numbers based on MIME type
  // Add magic numbers based on MIME type
  if (mimeType === MIME_TYPES.IMAGE.PNG) {
    // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    pngHeader.forEach((byte, i) => {
      view[i] = byte;
    });
  } else if (mimeType === MIME_TYPES.IMAGE.JPEG) {
    // JPEG magic number: FF D8 FF
    const jpegHeader = [0xff, 0xd8, 0xff];
    jpegHeader.forEach((byte, i) => {
      view[i] = byte;
    });
  } else if (mimeType === MIME_TYPES.IMAGE.WEBP) {
    // WebP: RIFF....WEBP
    const riff = [0x52, 0x49, 0x46, 0x46]; // RIFF
    const webp = [0x57, 0x45, 0x42, 0x50]; // WEBP
    riff.forEach((byte, i) => {
      view[i] = byte;
    });
    webp.forEach((byte, i) => {
      view[i + 8] = byte;
    });
  } else if (mimeType === MIME_TYPES.IMAGE.SVG) {
    // SVG: starts with <?xml or <svg
    const svg = '<?xml version="1.0"?><svg></svg>';
    const encoder = new TextEncoder();
    const encoded = encoder.encode(svg);
    encoded.forEach((byte, i) => {
      view[i] = byte;
    });
  }

  return buffer;
}

describe('BrandingSettingsService', () => {
  let db: Database;
  let organizationId: string;

  beforeAll(async () => {
    db = setupTestDatabase();

    // Create a test organization
    const [org] = await db
      .insert(schema.organizations)
      .values({
        id: crypto.randomUUID(),
        name: 'Test Organization',
        slug: `test-org-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    organizationId = org.id;
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean up settings tables before each test
    await db
      .delete(schema.brandingSettings)
      .where(eq(schema.brandingSettings.organizationId, organizationId));
    await db
      .delete(schema.platformSettings)
      .where(eq(schema.platformSettings.organizationId, organizationId));
  });

  function createService(r2?: ReturnType<typeof createMockR2>) {
    return new BrandingSettingsService({
      db,
      environment: 'test',
      organizationId,
      r2: r2 as unknown as R2Service,
      r2PublicUrlBase: 'https://cdn.example.com',
    });
  }

  function createMockR2() {
    return {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      list: vi.fn(),
      putJson: vi.fn(),
      generateSignedUrl: vi.fn(),
    };
  }

  describe('get()', () => {
    it('should return defaults when no branding settings exist', async () => {
      const service = createService();

      const result = await service.get();

      expect(result).toEqual(DEFAULT_BRANDING);
    });

    it('should return stored values when branding settings exist', async () => {
      const service = createService();

      // First, create platform settings hub row
      await db.insert(schema.platformSettings).values({
        organizationId,
      });

      // Insert branding settings
      await db.insert(schema.brandingSettings).values({
        organizationId,
        primaryColorHex: '#FF5733',
        logoUrl: 'https://example.com/logo.png',
      });

      const result = await service.get();

      expect(result.primaryColorHex).toBe('#FF5733');
      expect(result.logoUrl).toBe('https://example.com/logo.png');
    });
  });

  describe('update()', () => {
    it('should create branding settings via upsert when none exist', async () => {
      const service = createService();

      const result = await service.update({ primaryColorHex: '#123456' });

      expect(result.primaryColorHex).toBe('#123456');
      expect(result.logoUrl).toBeNull();

      // Verify database state
      const [dbRow] = await db
        .select()
        .from(schema.brandingSettings)
        .where(eq(schema.brandingSettings.organizationId, organizationId));
      expect(dbRow.primaryColorHex).toBe('#123456');
    });

    it('should update existing branding settings', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        primaryColorHex: '#AABBCC',
      });

      // Update
      const result = await service.update({ primaryColorHex: '#112233' });

      expect(result.primaryColorHex).toBe('#112233');
    });

    it('should return current state when no updates provided', async () => {
      const service = createService();

      // Create initial settings
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        primaryColorHex: '#DDEEFF',
      });

      // Update with empty object
      const result = await service.update({});

      expect(result.primaryColorHex).toBe('#DDEEFF');
    });

    it('should create platform settings hub row if not exists', async () => {
      const service = createService();

      await service.update({ primaryColorHex: '#ABCDEF' });

      // Verify hub row exists
      const [hubRow] = await db
        .select()
        .from(schema.platformSettings)
        .where(eq(schema.platformSettings.organizationId, organizationId));
      expect(hubRow).toBeDefined();
    });
  });

  describe('uploadLogo()', () => {
    it('should throw error when R2 not configured', async () => {
      const service = createService(); // No R2

      await expect(
        service.uploadLogo({
          buffer: new ArrayBuffer(100),
          mimeType: MIME_TYPES.IMAGE.PNG,
          size: 100,
        })
      ).rejects.toThrow('R2 service not configured for logo uploads');
    });

    it('should reject invalid MIME types', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      await expect(
        service.uploadLogo({
          buffer: new ArrayBuffer(100),
          mimeType: 'application/pdf',
          size: 100,
        })
      ).rejects.toThrow(InvalidFileTypeError);
    });

    it.skip('file size validation moved to @codex/validation validateLogoUpload()', async () => {
      // NOTE: File size validation now happens in @codex/validation validateLogoUpload()
      // before the service is called. See packages/validation/src/schemas/file-upload.ts
      // and packages/validation/src/__tests__/svg-sanitization.test.ts for validation tests.
    });

    it('should upload logo and update database', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      const fileData = createValidImageBuffer(MIME_TYPES.IMAGE.PNG, 1024);
      const result = await service.uploadLogo({
        buffer: fileData,
        mimeType: MIME_TYPES.IMAGE.PNG,
        size: 1024,
      });

      // Verify R2 was called
      expect(mockR2.put).toHaveBeenCalledWith(
        expect.stringContaining(`logos/${organizationId}/logo.png`),
        fileData,
        undefined,
        expect.objectContaining({
          contentType: MIME_TYPES.IMAGE.PNG,
          cacheControl: 'public, max-age=31536000',
        })
      );

      // Verify result
      expect(result.logoUrl).toContain(`logos/${organizationId}/logo.png`);
    });

    it('should delete old logo before uploading new one', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      // Create existing logo
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        logoUrl: 'https://old.com/logo.png',
        logoR2Path: 'logos/old/logo.png',
        primaryColorHex: DEFAULT_BRANDING.primaryColorHex,
      });

      // Upload new logo
      await service.uploadLogo({
        buffer: createValidImageBuffer(MIME_TYPES.IMAGE.JPEG, 1024),
        mimeType: MIME_TYPES.IMAGE.JPEG,
        size: 1024,
      });

      // Verify old logo was deleted
      expect(mockR2.delete).toHaveBeenCalledWith('logos/old/logo.png');
    });

    it('should handle different image types correctly', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      // Test PNG
      await service.uploadLogo({
        buffer: createValidImageBuffer(MIME_TYPES.IMAGE.PNG, 100),
        mimeType: MIME_TYPES.IMAGE.PNG,
        size: 100,
      });
      expect(mockR2.put).toHaveBeenLastCalledWith(
        expect.stringContaining('.png'),
        expect.anything(),
        undefined,
        expect.anything()
      );

      // Reset and test JPEG
      mockR2.put.mockClear();
      await service.uploadLogo({
        buffer: createValidImageBuffer(MIME_TYPES.IMAGE.JPEG, 100),
        mimeType: MIME_TYPES.IMAGE.JPEG,
        size: 100,
      });
      expect(mockR2.put).toHaveBeenLastCalledWith(
        expect.stringContaining('.jpg'),
        expect.anything(),
        undefined,
        expect.anything()
      );

      // Reset and test WebP
      mockR2.put.mockClear();
      await service.uploadLogo({
        buffer: createValidImageBuffer(MIME_TYPES.IMAGE.WEBP, 100),
        mimeType: MIME_TYPES.IMAGE.WEBP,
        size: 100,
      });
      expect(mockR2.put).toHaveBeenLastCalledWith(
        expect.stringContaining('.webp'),
        expect.anything(),
        undefined,
        expect.anything()
      );
    });

    // ── SVG sanitization (Codex-06ygy) ──────────────────────────────────────
    // Security: SVG uploads must be sanitized before hitting R2.
    // Unsanitized SVGs are stored XSS vectors when loaded via <object>,
    // <iframe>, direct URL, or inline rendering.

    it('strips <script> tags from SVG uploads (XSS prevention)', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      const malicious =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<script>alert(document.cookie)</script>' +
        '<circle cx="50" cy="50" r="40" fill="red"/>' +
        '</svg>';
      const maliciousBuffer = new TextEncoder().encode(malicious).buffer;

      await service.uploadLogo({
        buffer: maliciousBuffer,
        mimeType: MIME_TYPES.IMAGE.SVG,
        size: maliciousBuffer.byteLength,
      });

      // Capture the buffer that was actually written to R2
      expect(mockR2.put).toHaveBeenCalled();
      const [, writtenBuffer] = mockR2.put.mock.calls[0];
      const writtenSvg = new TextDecoder().decode(
        new Uint8Array(writtenBuffer as ArrayBuffer)
      );

      // Script must be stripped
      expect(writtenSvg).not.toContain('<script>');
      expect(writtenSvg).not.toContain('alert(');
      // Legitimate content preserved
      expect(writtenSvg).toContain('<circle');
    });

    it('strips event handler attributes (onload, onclick) from SVG uploads', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      const malicious =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(1)">' +
        '<circle cx="50" cy="50" r="40" onclick="alert(2)"/>' +
        '</svg>';
      const buffer = new TextEncoder().encode(malicious).buffer;

      await service.uploadLogo({
        buffer,
        mimeType: MIME_TYPES.IMAGE.SVG,
        size: buffer.byteLength,
      });

      const [, writtenBuffer] = mockR2.put.mock.calls[0];
      const writtenSvg = new TextDecoder().decode(
        new Uint8Array(writtenBuffer as ArrayBuffer)
      );

      expect(writtenSvg).not.toMatch(/on\w+\s*=/i);
    });

    it('preserves legitimate SVG content through sanitization', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      const cleanSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
        '<path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor"/>' +
        '</svg>';
      const buffer = new TextEncoder().encode(cleanSvg).buffer;

      await service.uploadLogo({
        buffer,
        mimeType: MIME_TYPES.IMAGE.SVG,
        size: buffer.byteLength,
      });

      const [, writtenBuffer] = mockR2.put.mock.calls[0];
      const writtenSvg = new TextDecoder().decode(
        new Uint8Array(writtenBuffer as ArrayBuffer)
      );

      // Structural elements preserved
      expect(writtenSvg).toContain('<svg');
      expect(writtenSvg).toContain('<path');
      expect(writtenSvg).toContain('viewBox="0 0 24 24"');
      expect(writtenSvg).toContain('M12 2L2 7l10 5 10-5-10-5z');
    });

    it('uses 1-hour cache-control for SVG (not 1-year)', async () => {
      // SVGs are stored at a fixed key (logos/{orgId}/logo.svg); a 1-year
      // cache would trap re-uploads behind CDN for a year. Match ImageProcessingService.
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
      const buffer = new TextEncoder().encode(svg).buffer;

      await service.uploadLogo({
        buffer,
        mimeType: MIME_TYPES.IMAGE.SVG,
        size: buffer.byteLength,
      });

      expect(mockR2.put).toHaveBeenCalledWith(
        expect.stringContaining('.svg'),
        expect.anything(),
        undefined,
        expect.objectContaining({
          contentType: MIME_TYPES.IMAGE.SVG,
          cacheControl: 'public, max-age=3600',
        })
      );
    });

    it('keeps 1-year cache-control for raster (regression guard)', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      await service.uploadLogo({
        buffer: createValidImageBuffer(MIME_TYPES.IMAGE.PNG, 100),
        mimeType: MIME_TYPES.IMAGE.PNG,
        size: 100,
      });

      expect(mockR2.put).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
        expect.objectContaining({
          cacheControl: 'public, max-age=31536000',
        })
      );
    });
  });

  describe('deleteLogo()', () => {
    it('should throw error when R2 not configured', async () => {
      const service = createService(); // No R2

      await expect(service.deleteLogo()).rejects.toThrow(
        'R2 service not configured for logo operations'
      );
    });

    it('should delete logo from R2 and update database', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      // Create existing logo
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        logoUrl: 'https://cdn.example.com/logos/test/logo.png',
        logoR2Path: 'logos/test/logo.png',
        primaryColorHex: '#3B82F6',
      });

      const result = await service.deleteLogo();

      // Verify R2 delete was called
      expect(mockR2.delete).toHaveBeenCalledWith('logos/test/logo.png');

      // Verify logo is cleared
      expect(result.logoUrl).toBeNull();
    });

    it('should handle case when no logo exists', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      // No logo exists
      const result = await service.deleteLogo();

      // Should not throw, just return defaults
      expect(result.logoUrl).toBeNull();
      expect(mockR2.delete).not.toHaveBeenCalled();
    });

    it('should continue if R2 delete fails', async () => {
      const mockR2 = createMockR2();
      mockR2.delete.mockRejectedValue(new Error('R2 error'));
      const service = createService(mockR2);

      // Create existing logo
      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        logoUrl: 'https://cdn.example.com/logos/test/logo.png',
        logoR2Path: 'logos/test/logo.png',
        primaryColorHex: '#3B82F6',
      });

      // Should not throw even if R2 fails
      const result = await service.deleteLogo();

      expect(result.logoUrl).toBeNull();
    });
  });

  describe('deleteIntroVideo()', () => {
    /**
     * Helper to seed a media item linked as the org's intro video.
     * Returns { creatorId, mediaItemId, hlsPrefix }.
     */
    async function seedLinkedIntroVideo() {
      const [creatorId] = await seedTestUsers(db, 1);
      // Insert in `uploaded` state so we don't trigger the
      // `status_ready_requires_keys` check constraint. deleteIntroVideo()
      // only reads creatorId; the media's status is irrelevant for cleanup.
      const [media] = await db
        .insert(schema.mediaItems)
        .values(createTestMediaItemInput(creatorId, { status: 'uploaded' }))
        .returning();

      await db.insert(schema.platformSettings).values({ organizationId });
      await db.insert(schema.brandingSettings).values({
        organizationId,
        introVideoMediaItemId: media.id,
        introVideoUrl: `https://cdn.example.com/${creatorId}/hls/${media.id}/master.m3u8`,
        primaryColorHex: DEFAULT_BRANDING.primaryColorHex,
      });

      return {
        creatorId,
        mediaItemId: media.id,
        hlsPrefix: `${creatorId}/hls/${media.id}/`,
      };
    }

    it('soft-deletes the media item and clears branding references', async () => {
      const mockR2 = createMockR2();
      mockR2.list.mockResolvedValue({ objects: [], truncated: false });
      const service = createService(mockR2);

      const { mediaItemId } = await seedLinkedIntroVideo();

      const result = await service.deleteIntroVideo();

      // Branding references cleared
      expect(result.introVideoMediaItemId).toBeNull();
      expect(result.introVideoUrl).toBeNull();

      // Media item soft-deleted
      const [media] = await db
        .select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaItemId));
      expect(media.deletedAt).not.toBeNull();
    });

    it('hard-deletes every HLS object under the intro video prefix from R2', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);
      const { mediaItemId, hlsPrefix } = await seedLinkedIntroVideo();

      // Simulate R2 returning a manifest + a few segment files for the prefix
      const objects = [
        { key: `${hlsPrefix}master.m3u8` },
        { key: `${hlsPrefix}1080p/index.m3u8` },
        { key: `${hlsPrefix}1080p/segment_001.ts` },
        { key: `${hlsPrefix}1080p/segment_002.ts` },
        { key: `${hlsPrefix}preview/preview.m3u8` },
      ];
      mockR2.list.mockResolvedValue({ objects, truncated: false });

      await service.deleteIntroVideo();

      // list() was called with the correct HLS prefix
      expect(mockR2.list).toHaveBeenCalledWith(
        expect.objectContaining({ prefix: hlsPrefix })
      );

      // Every listed object was deleted
      for (const obj of objects) {
        expect(mockR2.delete).toHaveBeenCalledWith(obj.key);
      }
      expect(mockR2.delete).toHaveBeenCalledTimes(objects.length);

      // Suppress unused-var lint
      void mediaItemId;
    });

    it('paginates list results when R2 returns truncated pages', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);
      const { hlsPrefix } = await seedLinkedIntroVideo();

      // Page 1: truncated with cursor
      mockR2.list
        .mockResolvedValueOnce({
          objects: [
            { key: `${hlsPrefix}1080p/segment_001.ts` },
            { key: `${hlsPrefix}1080p/segment_002.ts` },
          ],
          truncated: true,
          cursor: 'next-page',
        })
        // Page 2: final page
        .mockResolvedValueOnce({
          objects: [{ key: `${hlsPrefix}1080p/segment_003.ts` }],
          truncated: false,
        });

      await service.deleteIntroVideo();

      // Two list calls — first without cursor, second with cursor
      expect(mockR2.list).toHaveBeenCalledTimes(2);
      expect(mockR2.list).toHaveBeenNthCalledWith(1, {
        prefix: hlsPrefix,
        cursor: undefined,
      });
      expect(mockR2.list).toHaveBeenNthCalledWith(2, {
        prefix: hlsPrefix,
        cursor: 'next-page',
      });

      // All three objects across both pages were deleted
      expect(mockR2.delete).toHaveBeenCalledTimes(3);
    });

    it('does not throw when R2 list fails — DB writes still complete', async () => {
      const mockR2 = createMockR2();
      mockR2.list.mockRejectedValue(new Error('R2 list error'));
      const service = createService(mockR2);

      const { mediaItemId } = await seedLinkedIntroVideo();

      // Should not throw — orphaned HLS files are an acceptable tradeoff
      const result = await service.deleteIntroVideo();
      expect(result.introVideoMediaItemId).toBeNull();
      expect(result.introVideoUrl).toBeNull();

      // Soft-delete still happened despite R2 failure
      const [media] = await db
        .select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaItemId));
      expect(media.deletedAt).not.toBeNull();
    });

    it('does not throw when an individual R2 delete fails', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);
      const { hlsPrefix } = await seedLinkedIntroVideo();

      mockR2.list.mockResolvedValue({
        objects: [
          { key: `${hlsPrefix}master.m3u8` },
          { key: `${hlsPrefix}1080p/segment_001.ts` },
        ],
        truncated: false,
      });
      // First delete succeeds, second fails
      mockR2.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('R2 delete error'));

      await expect(service.deleteIntroVideo()).resolves.not.toThrow();
      expect(mockR2.delete).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when no intro video is linked', async () => {
      const mockR2 = createMockR2();
      const service = createService(mockR2);

      // No branding row, no media item linked
      const result = await service.deleteIntroVideo();

      expect(result.introVideoMediaItemId).toBeNull();
      expect(mockR2.list).not.toHaveBeenCalled();
      expect(mockR2.delete).not.toHaveBeenCalled();
    });
  });
});
