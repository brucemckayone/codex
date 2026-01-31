import type { R2Service } from '@codex/cloudflare-clients';
import type { DB } from '@codex/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../processor';
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
    ]).buffer;
    return new File([pngBuffer], filename, { type: mimeType });
  }

  if (mimeType === 'image/svg+xml') {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const encoder = new TextEncoder();
    return new File([encoder.encode(svgContent)], filename, { type: mimeType });
  }

  // Fallback JPEG signature
  const jpegBuffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
  return new File([jpegBuffer], filename, { type: mimeType });
}

// Mock database
const mockDb = {
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ id: 'content-1' }]),
    }),
  }),
} as unknown as DB;

// Mock R2Service (not raw R2Bucket)
const mockR2Service = {
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
} as unknown as R2Service;

// Mock processor
vi.mock('../processor', () => ({
  processImageVariants: vi.fn(),
}));

// Mock SVG sanitization from @codex/validation
vi.mock('@codex/validation', async () => {
  const actual = await vi.importActual('@codex/validation');
  return {
    ...actual,
    sanitizeSvgContent: vi.fn().mockImplementation(async (svgText: string) => {
      // Mock implementation that preserves the SVG but would sanitize in real code
      return svgText;
    }),
  };
});

describe('ImageProcessingService', () => {
  let service: ImageProcessingService;
  let mockDbQuery: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock for delete methods that query database
    mockDbQuery = {
      users: {
        findFirst: vi.fn().mockResolvedValue({
          avatarUrl: 'https://test.r2.dev/avatars/user-1/lg.webp',
        }),
      },
      content: {
        findFirst: vi.fn().mockResolvedValue({
          thumbnailUrl:
            'https://test.r2.dev/user-1/content-thumbnails/content-1/lg.webp',
        }),
      },
      organizations: {
        findFirst: vi.fn().mockResolvedValue({
          logoUrl: 'https://test.r2.dev/user-1/branding/logo/lg.webp',
        }),
      },
    };

    service = new ImageProcessingService({
      db: { ...mockDb, query: mockDbQuery } as unknown as DB,
      environment: 'test',
      r2Service: mockR2Service,
      r2PublicUrlBase: 'https://test.r2.dev',
    });
  });

  describe('processContentThumbnail', () => {
    it('should process raster image and upload three variants', async () => {
      const file = createTestImageFile('image/png', 'test.png');

      // Mock processing success
      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
      });

      const result = await service.processContentThumbnail(
        'content-1',
        'user-1',
        file
      );

      expect(processor.processImageVariants).toHaveBeenCalled();

      expect(result.url).toContain('user-1/content-thumbnails/content-1');
      expect(result.url).toContain('test.r2.dev'); // R2 public URL base
      expect(result.size).toBe(1); // lg variant is Uint8Array([3]), byteLength is 1
      expect(result.mimeType).toBe('image/png'); // Returns original MIME type
      expect(mockR2Service.put).toHaveBeenCalledTimes(3);

      // Verify one of the calls includes cache headers
      // R2Service.put signature: (key, body, metadata, httpMetadata)
      expect(mockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('/sm.webp'),
        expect.any(Uint8Array),
        {}, // Empty metadata object (not undefined)
        {
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      );
    });

    it('should update database with thumbnail URL', async () => {
      const file = createTestImageFile('image/jpeg', 'test.jpg');

      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
      });

      await service.processContentThumbnail('content-1', 'user-1', file);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('processUserAvatar', () => {
    it('should process raster avatar and upload three variants', async () => {
      const file = createTestImageFile('image/jpeg', 'avatar.jpg');

      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1, 2]),
        md: new Uint8Array([3, 4]),
        lg: new Uint8Array([5, 6]),
      });

      const result = await service.processUserAvatar('user-1', file);

      expect(processor.processImageVariants).toHaveBeenCalled();
      expect(result.url).toContain('avatars/user-1');
      expect(result.url).toContain('lg.webp'); // Large variant used as primary
      expect(result.mimeType).toBe('image/jpeg'); // Returns original MIME type
      expect(mockR2Service.put).toHaveBeenCalledTimes(3); // sm, md, lg
    });

    it('should update user avatarUrl column', async () => {
      const file = createTestImageFile('image/png', 'avatar.png');

      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
      });

      await service.processUserAvatar('user-1', file);

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('processOrgLogo', () => {
    it('should process SVG logo without variants', async () => {
      const file = createTestImageFile('image/svg+xml', 'logo.svg');

      const result = await service.processOrgLogo('org-1', 'user-1', file);

      // Should NOT call processor for SVG
      expect(processor.processImageVariants).not.toHaveBeenCalled();

      expect(result.url).toContain('logo.svg');
      expect(result.url).toContain('test.r2.dev'); // R2 public URL base
      expect(result.mimeType).toBe('image/svg+xml');
      expect(mockR2Service.put).toHaveBeenCalledTimes(1);

      // SVG upload uses 3-param signature (key, body, httpMetadata) - skips optional metadata
      expect(mockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('logo.svg'),
        expect.any(Uint8Array),
        {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=31536000, immutable',
        }
      );
    });

    it('should process raster logo with three variants', async () => {
      const file = createTestImageFile('image/png', 'logo.png');

      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
      });

      const result = await service.processOrgLogo('org-1', 'user-1', file);

      expect(processor.processImageVariants).toHaveBeenCalled();
      expect(result.url).toContain('user-1/branding/logo');
      expect(result.url).toContain('lg.webp');
      expect(mockR2Service.put).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteContentThumbnail', () => {
    it('should delete all three size variants from R2', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(mockR2Service.delete).toHaveBeenCalledTimes(3);
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/sm.webp')
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/md.webp')
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/lg.webp')
      );
    });

    it('should clear thumbnailUrl in database', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe('deleteUserAvatar', () => {
    it('should delete all three size variants from R2', async () => {
      await service.deleteUserAvatar('user-1');

      expect(mockR2Service.delete).toHaveBeenCalledTimes(3);
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('avatars/user-1')
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('sm.webp')
      );
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('lg.webp')
      );
    });

    it('should clear avatarUrl in database', async () => {
      await service.deleteUserAvatar('user-1');

      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should handle missing avatar gracefully', async () => {
      mockDbQuery.users.findFirst.mockResolvedValueOnce({ avatarUrl: null });

      await service.deleteUserAvatar('user-1');

      expect(mockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteOrgLogo', () => {
    it('should delete all three size variants for raster logo', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: 'https://test.r2.dev/organizations/org-1/logo/lg.webp',
      });

      await service.deleteOrgLogo('org-1');

      expect(mockR2Service.delete).toHaveBeenCalledTimes(3);
    });

    it('should delete single SVG file', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: 'https://test.r2.dev/organizations/org-1/logo.svg',
      });

      await service.deleteOrgLogo('org-1');

      expect(mockR2Service.delete).toHaveBeenCalledTimes(1);
      expect(mockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('logo.svg')
      );
    });

    it('should handle missing logo gracefully', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: null,
      });

      await service.deleteOrgLogo('org-1');

      expect(mockR2Service.delete).not.toHaveBeenCalled();
    });
  });
});
