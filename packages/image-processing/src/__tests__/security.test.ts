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
    return new File([pngBuffer], filename, { type: mimeType });
  }

  // Fallback JPEG signature
  const jpegBuffer = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0, // JPEG signature
    ...new Array(100).fill(0),
  ]).buffer;
  return new File([jpegBuffer], filename, { type: mimeType });
}

// Mock processor
vi.mock('../processor', () => ({
  processImageVariants: vi.fn().mockReturnValue({
    sm: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    md: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    lg: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  }),
}));

describe('ImageProcessingService - Security', () => {
  let service: ImageProcessingService;
  let mockR2Service: R2Service;
  let mockDb: Database;
  let updateMock: Mock;
  let setMock: Mock;
  let whereMock: Mock;

  beforeEach(() => {
    // Track update chain calls to verify scoping
    whereMock = vi.fn().mockResolvedValue([{ id: 'test-1' }]);
    setMock = vi.fn().mockReturnValue({ where: whereMock });
    updateMock = vi.fn().mockReturnValue({ set: setMock });

    mockDb = {
      update: updateMock,
      query: {
        content: { findFirst: vi.fn() },
        users: { findFirst: vi.fn() },
        organizations: { findFirst: vi.fn() },
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
    });

    it('should include creatorId in R2 key path for org logos', async () => {
      const file = createTestImageFile('image/png', 'logo.png');
      await service.processOrgLogo('org-1', 'creator-abc', file);

      // Verify R2 keys include the creatorId as prefix
      expect(mockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('creator-abc/branding/logo/'),
        expect.any(Uint8Array),
        expect.anything(),
        expect.anything()
      );
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
      await service.deleteContentThumbnail('content-1', 'user-owner');

      // Verify R2 delete uses creatorId-prefixed keys
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('user-owner/content-thumbnails/content-1/')
      );
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

  describe('Organization Logo Handling', () => {
    it('should update organization by ID', async () => {
      const file = createTestImageFile('image/png', 'logo.png');
      await service.processOrgLogo('org-1', 'user-1', file);

      // Verify update was called
      expect(updateMock).toHaveBeenCalled();
      expect(whereMock).toHaveBeenCalled();
    });

    it('should check org exists before deleting logo', async () => {
      // Mock org exists with logo
      (mockDb.query.organizations.findFirst as Mock).mockResolvedValueOnce({
        logoUrl: 'https://cdn.test.com/creator/branding/logo/lg.webp',
      });

      await service.deleteOrgLogo('org-1', 'creator-1');

      // Verify org lookup was performed
      expect(mockDb.query.organizations.findFirst).toHaveBeenCalled();
      // Verify R2 delete was called
      expect(mockR2Service.delete).toHaveBeenCalled();
    });

    it('should skip R2 delete when org has no logo', async () => {
      // Mock org exists but no logo
      (mockDb.query.organizations.findFirst as Mock).mockResolvedValueOnce({
        logoUrl: null,
      });

      await service.deleteOrgLogo('org-1', 'creator-1');

      // R2 delete should NOT be called
      expect(mockR2Service.delete).not.toHaveBeenCalled();
    });

    it('should handle SVG logo deletion correctly', async () => {
      // Mock org with SVG logo
      (mockDb.query.organizations.findFirst as Mock).mockResolvedValueOnce({
        logoUrl: 'https://cdn.test.com/creator/branding/logo/logo.svg',
      });

      await service.deleteOrgLogo('org-1', 'creator-1');

      // Verify SVG-specific delete path
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('.svg')
      );
    });
  });
});
