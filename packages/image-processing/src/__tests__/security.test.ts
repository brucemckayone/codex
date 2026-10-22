/**
 * Security Tests for Image Processing Service
 *
 * Tests multi-tenancy scoping and R2 key path isolation.
 * The service uses creatorId-prefixed R2 keys as its primary security boundary.
 */

import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageProcessingService } from '../service';

/**
 * Creates a File object with proper ArrayBuffer content for testing
 */
function createTestImageFile(mimeType: string, filename: string): File {
  if (mimeType === 'image/png') {
    const pngBuffer = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      ...new Array(100).fill(0),
    ]).buffer;
    return new File([new Uint8Array(pngBuffer)], filename, { type: mimeType });
  }

  // Fallback JPEG signature
  const jpegBuffer = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0, // JPEG signature
    ...new Array(100).fill(0),
  ]).buffer;
  return new File([new Uint8Array(jpegBuffer)], filename, { type: mimeType });
}

// Mock processor: every still goes through the page-image pipeline
// (Codex-kk9nv.5), which returns four sizes and the source's size.
vi.mock('../processor', () => ({
  processStillVariants: vi.fn().mockReturnValue({
    variants: {
      sm: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      md: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      lg: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
      xl: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    },
    width: 1200,
    height: 800,
  }),
}));

/** Every key handed to `R2Service.put` so far. */
function putKeys(r2: R2Service): string[] {
  return (r2.put as Mock).mock.calls.map((call) => call[0] as string);
}

describe('ImageProcessingService - Security', () => {
  let service: ImageProcessingService;
  let mockR2Service: R2Service;
  let mockDb: Database;
  let updateMock: Mock;
  let setMock: Mock;
  let whereMock: Mock;

  beforeEach(() => {
    // Track update chain calls to verify scoping
    // Awaited, the matched rows; `.returning()` on it resolves them too, as
    // drizzle's builder does (the avatar write checks a row matched).
    whereMock = vi.fn(() =>
      Object.assign(Promise.resolve([{ id: 'test-1' }]), {
        returning: vi.fn().mockResolvedValue([{ id: 'test-1' }]),
      })
    );
    setMock = vi.fn().mockReturnValue({ where: whereMock });
    updateMock = vi.fn().mockReturnValue({ set: setMock });

    mockDb = {
      update: updateMock,
      query: {
        content: { findFirst: vi.fn() },
        users: { findFirst: vi.fn() },
      },
    } as unknown as Database;

    mockR2Service = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(new Uint8Array()),
      list: vi.fn().mockResolvedValue({ objects: [] }),
    } as unknown as R2Service;

    service = new ImageProcessingService({
      db: mockDb,
      environment: 'test',
      r2Service: mockR2Service,
      r2PublicUrlBase: 'https://cdn.test.com',
    });
  });

  describe('R2 Key Path Isolation', () => {
    it('should include creatorId in R2 key path for content thumbnails', async () => {
      const file = createTestImageFile('image/png', 'thumbnail.png');
      await service.processContentThumbnail('content-1', 'user-owner', file);

      // Verify R2 keys include the creatorId as prefix
      expect(mockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('user-owner/content-thumbnails/content-1/'),
        expect.any(Uint8Array),
        expect.anything(),
        expect.anything()
      );
      // Every object, xl included, sits in ONE new sized folder under the
      // creator's prefix (Codex-kk9nv.5) — none escapes the tenant boundary.
      const keys = putKeys(mockR2Service);
      expect(keys).toHaveLength(4);
      expect(new Set(keys.map((key) => key.replace(/\/[^/]+$/, ''))).size).toBe(
        1
      );
      for (const key of keys) {
        expect(key).toMatch(
          /^user-owner\/content-thumbnails\/content-1\/\d+x\d+-[0-9a-f]{8}\/(sm|md|lg|xl)\.webp$/
        );
        expect(key.startsWith('user-owner/content-thumbnails/content-1/')).toBe(
          true
        );
      }
    });

    it('should include userId in R2 key path for avatars', async () => {
      const file = createTestImageFile('image/png', 'avatar.png');
      await service.processUserAvatar('user-123', file);

      // Verify R2 keys include the userId
      expect(mockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('user-123'),
        expect.any(Uint8Array),
        expect.anything(),
        expect.anything()
      );
      // Every object, xl included, sits in one new folder under the user's own
      // avatar prefix (Codex-kk9nv.5).
      const keys = putKeys(mockR2Service);
      expect(keys).toHaveLength(4);
      for (const key of keys) {
        expect(key).toMatch(
          /^avatars\/user-123\/\d+x\d+-[0-9a-f]{8}\/(sm|md|lg|xl)\.webp$/
        );
        expect(key.startsWith('avatars/user-123/')).toBe(true);
      }
    });
  });

  describe('Content Thumbnail Database Scoping', () => {
    it('should include creatorId in WHERE clause for thumbnail updates', async () => {
      const file = createTestImageFile('image/png', 'thumbnail.png');
      await service.processContentThumbnail('content-1', 'user-owner', file);

      // Verify update was called
      expect(updateMock).toHaveBeenCalled();
      // Verify WHERE clause was invoked (contains AND of contentId + creatorId)
      expect(whereMock).toHaveBeenCalled();
    });

    it('should include creatorId in WHERE clause for thumbnail deletion', async () => {
      await service.deleteContentThumbnail('content-1', 'user-owner');

      // Verify WHERE clause was invoked for scoped delete
      expect(whereMock).toHaveBeenCalled();
    });

    it('should use creatorId prefix in R2 delete keys', async () => {
      (mockDb.query.content.findFirst as Mock).mockResolvedValueOnce({
        thumbnailUrl:
          'https://cdn.test.com/user-owner/content-thumbnails/content-1/1200x800-0a1b2c3d/lg.webp',
      });
      await service.deleteContentThumbnail('content-1', 'user-owner');

      // Verify R2 delete uses creatorId-prefixed keys
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('user-owner/content-thumbnails/content-1/')
      );
    });

    it("never deletes another creator's files named by a hand-set thumbnail URL", async () => {
      // `thumbnailUrl` is accepted from a PATCH body as any URL on the CDN
      // (Codex-8so68), so it can name ANOTHER creator's upload. Every cleanup
      // derives what it may delete from THIS content's own base key, so
      // replacing, dropping or deleting that URL touches none of their files.
      const foreign =
        'https://cdn.test.com/user-victim/content-thumbnails/content-9/1200x800-0a1b2c3d/lg.webp';
      (mockDb.query.content.findFirst as Mock).mockResolvedValue({
        thumbnailUrl: foreign,
      });

      await service.deleteContentThumbnail('content-1', 'user-owner');
      await service.deleteDroppedContentThumbnail(
        'content-1',
        'user-owner',
        foreign
      );
      await service.processContentThumbnail(
        'content-1',
        'user-owner',
        createTestImageFile('image/png', 'thumbnail.png')
      );

      expect(mockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('User Avatar Database Scoping', () => {
    it('should include userId in WHERE clause for avatar updates', async () => {
      const file = createTestImageFile('image/png', 'avatar.png');
      await service.processUserAvatar('user-1', file);

      // Verify update chain was called
      expect(updateMock).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
    });

    it('should check user exists before deleting avatar', async () => {
      // Mock user exists with avatar
      (mockDb.query.users.findFirst as Mock).mockResolvedValueOnce({
        avatarUrl: 'https://cdn.test.com/avatars/user-1/lg.webp',
      });

      await service.deleteUserAvatar('user-1');

      // Verify user lookup was performed
      expect(mockDb.query.users.findFirst).toHaveBeenCalled();
      // Verify R2 delete was called
      expect(mockR2Service.delete).toHaveBeenCalled();
    });

    it('should skip R2 delete when user has no avatar', async () => {
      // Mock user exists but no avatar
      (mockDb.query.users.findFirst as Mock).mockResolvedValueOnce({
        avatarUrl: null,
      });

      await service.deleteUserAvatar('user-1');

      // R2 delete should NOT be called
      expect(mockR2Service.delete).not.toHaveBeenCalled();
    });
  });
});
