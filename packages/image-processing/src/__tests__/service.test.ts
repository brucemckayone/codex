import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../processor';
import { ImageProcessingService } from '../service';

/** Lightweight mock shape for db.query table objects used in tests */
interface MockQueryTable {
  findFirst: Mock;
}
interface MockDbQuery {
  users: MockQueryTable;
  content: MockQueryTable;
  organizations: MockQueryTable;
}
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
      0x0a, // PNG signature (8 bytes)
      ...new Array(100).fill(0), // Padding to make file realistic
    ]).buffer;
    return new File([pngBuffer], filename, { type: mimeType });
  }

  if (mimeType === 'image/svg+xml') {
    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const encoder = new TextEncoder();
    return new File([encoder.encode(svgContent)], filename, { type: mimeType });
  }

  if (mimeType === 'image/gif') {
    const gifBuffer = new Uint8Array([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // GIF89a signature
      ...new Array(100).fill(0), // Padding
    ]).buffer;
    return new File([gifBuffer], filename, { type: mimeType });
  }

  if (mimeType === 'image/webp') {
    const webpBuffer = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46, // RIFF
      0x00,
      0x00,
      0x00,
      0x00, // File size placeholder
      0x57,
      0x45,
      0x42,
      0x50, // WEBP
      ...new Array(100).fill(0), // Padding
    ]).buffer;
    return new File([webpBuffer], filename, { type: mimeType });
  }

  // Fallback JPEG signature (must be at least 4 bytes)
  const jpegBuffer = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0, // JPEG signature (4 bytes minimum)
    ...new Array(100).fill(0), // Padding to make file realistic
  ]).buffer;
  return new File([jpegBuffer], filename, { type: mimeType });
}

// Base mock implementations (will be recreated in beforeEach)
const createMockDb = () =>
  ({
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'content-1' }]),
      }),
    }),
  }) as unknown as Database;

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
  let mockDbQuery: MockDbQuery;
  let testMockR2Service: R2Service;
  let testMockDb: Database;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset R2Service mock to default implementation
    testMockR2Service = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Service;

    // Reset database mock to default implementation
    testMockDb = createMockDb();

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
      db: { ...testMockDb, query: mockDbQuery } as unknown as Database,
      environment: 'test',
      r2Service: testMockR2Service,
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
      expect(result.mimeType).toBe('image/webp'); // Stored as WebP after processing
      expect(testMockR2Service.put).toHaveBeenCalledTimes(3);

      // Verify one of the calls includes cache headers
      // R2Service.put signature: (key, body, metadata, httpMetadata)
      expect(testMockR2Service.put).toHaveBeenCalledWith(
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

      expect(testMockDb.update).toHaveBeenCalled();
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
      expect(result.mimeType).toBe('image/webp'); // Stored as WebP after processing
      expect(testMockR2Service.put).toHaveBeenCalledTimes(3); // sm, md, lg
    });

    it('should update user avatarUrl column', async () => {
      const file = createTestImageFile('image/png', 'avatar.png');

      vi.mocked(processor.processImageVariants).mockReturnValueOnce({
        sm: new Uint8Array([1]),
        md: new Uint8Array([2]),
        lg: new Uint8Array([3]),
      });

      await service.processUserAvatar('user-1', file);

      expect(testMockDb.update).toHaveBeenCalled();
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
      expect(testMockR2Service.put).toHaveBeenCalledTimes(1);

      // SVG upload uses 4-param signature (key, body, metadata, httpMetadata)
      // SVG uses shorter cache (1 hour) because filename is fixed, allowing logo updates to propagate
      expect(testMockR2Service.put).toHaveBeenCalledWith(
        expect.stringContaining('logo.svg'),
        expect.any(Uint8Array),
        {},
        {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=3600',
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
      expect(testMockR2Service.put).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteContentThumbnail', () => {
    it('should delete all three size variants from R2', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(3);
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/sm.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/md.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('/lg.webp')
      );
    });

    it('should clear thumbnailUrl in database', async () => {
      await service.deleteContentThumbnail('content-1', 'user-1');

      expect(testMockDb.update).toHaveBeenCalled();
    });
  });

  describe('deleteUserAvatar', () => {
    it('should delete all three size variants from R2', async () => {
      await service.deleteUserAvatar('user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(3);
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('avatars/user-1')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('sm.webp')
      );
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('lg.webp')
      );
    });

    it('should clear avatarUrl in database', async () => {
      await service.deleteUserAvatar('user-1');

      expect(testMockDb.update).toHaveBeenCalled();
    });

    it('should handle missing avatar gracefully', async () => {
      mockDbQuery.users.findFirst.mockResolvedValueOnce({ avatarUrl: null });

      await service.deleteUserAvatar('user-1');

      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteOrgLogo', () => {
    it('should delete all three size variants for raster logo', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: 'https://test.r2.dev/organizations/org-1/logo/lg.webp',
      });

      await service.deleteOrgLogo('org-1', 'user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(3);
    });

    it('should delete single SVG file', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: 'https://test.r2.dev/organizations/org-1/logo.svg',
      });

      await service.deleteOrgLogo('org-1', 'user-1');

      expect(testMockR2Service.delete).toHaveBeenCalledTimes(1);
      expect(testMockR2Service.delete).toHaveBeenCalledWith(
        expect.stringContaining('logo.svg')
      );
    });

    it('should handle missing logo gracefully', async () => {
      mockDbQuery.organizations.findFirst.mockResolvedValueOnce({
        logoUrl: null,
      });

      await service.deleteOrgLogo('org-1', 'user-1');

      expect(testMockR2Service.delete).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    describe('File Size Validation', () => {
      it('should reject files larger than 5MB', async () => {
        // Create a file larger than 5MB (5 * 1024 * 1024 bytes)
        const largeBuffer = new ArrayBuffer(5 * 1024 * 1024 + 1);
        const largeFile = new File([largeBuffer], 'large.jpg', {
          type: 'image/jpeg',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', largeFile)
        ).rejects.toThrow(/exceeds maximum.*5MB/i);
      });

      it('should accept files exactly at 5MB limit', async () => {
        // Create file exactly at limit with valid JPEG magic bytes
        const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
        const padding = new Uint8Array(5 * 1024 * 1024 - jpegSignature.length);
        const combinedBuffer = new Uint8Array(5 * 1024 * 1024);
        combinedBuffer.set(jpegSignature, 0);
        combinedBuffer.set(padding, jpegSignature.length);

        const file = new File([combinedBuffer], 'exactly5mb.jpg', {
          type: 'image/jpeg',
        });

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).resolves.not.toThrow();
      });
    });

    describe('MIME Type Validation', () => {
      it('should reject unsupported MIME types', async () => {
        const file = new File([new ArrayBuffer(100)], 'test.bmp', {
          type: 'image/bmp',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/unsupported.*mime/i);
      });

      it('should reject non-image MIME types', async () => {
        const file = new File([new ArrayBuffer(100)], 'test.pdf', {
          type: 'application/pdf',
        });

        await expect(service.processUserAvatar('user-1', file)).rejects.toThrow(
          /unsupported.*mime/i
        );
      });
    });

    describe('Magic Byte Validation', () => {
      it('should reject files with invalid PNG magic bytes', async () => {
        const invalidPngBuffer = new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x00, // Invalid signature
        ]).buffer;
        const file = new File([invalidPngBuffer], 'fake.png', {
          type: 'image/png',
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/invalid.*signature|magic byte/i);
      });

      it('should reject files with invalid JPEG magic bytes', async () => {
        const invalidJpegBuffer = new Uint8Array([
          0x00,
          0x00,
          0x00,
          0x00, // Invalid signature (needs at least 4 bytes)
          ...new Array(100).fill(0), // Padding
        ]).buffer;
        const file = new File([invalidJpegBuffer], 'fake.jpg', {
          type: 'image/jpeg',
        });

        await expect(service.processUserAvatar('user-1', file)).rejects.toThrow(
          /invalid.*signature|magic byte|content does not match/i
        );
      });

      it('should reject files with MIME type mismatch (JPEG claiming to be PNG)', async () => {
        const jpegBuffer = new Uint8Array([
          0xff,
          0xd8,
          0xff,
          0xe0, // JPEG magic bytes
          ...new Array(100).fill(0), // Padding
        ]).buffer;
        const file = new File([jpegBuffer], 'fake.png', {
          type: 'image/png', // Claims PNG but has JPEG magic bytes
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(
          /invalid.*signature|magic byte|content does not match/i
        );
      });
    });

    describe('R2 Upload Failures', () => {
      it('should propagate R2Service.put errors', async () => {
        const file = createTestImageFile('image/jpeg', 'test.jpg');

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        testMockR2Service.put = vi
          .fn()
          .mockRejectedValue(new Error('R2 service unavailable'));

        // With Promise.allSettled, we get a cleaner error about upload failure
        // rather than the raw R2 error, and cleanup is guaranteed
        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/upload failed.*variant.*failed/i);
      });

      it('should propagate R2Service.delete errors', async () => {
        testMockR2Service.delete = vi
          .fn()
          .mockRejectedValue(new Error('R2 delete failed'));

        await expect(
          service.deleteContentThumbnail('content-1', 'user-1')
        ).rejects.toThrow(/R2 delete failed/i);
      });
    });

    describe('Database Failures', () => {
      it('should propagate database update errors', async () => {
        const file = createTestImageFile('image/png', 'test.png');

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        // Create a new mock DB with error
        const errorMockDb = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockRejectedValue(new Error('Database error')),
            }),
          }),
        } as unknown as DB;

        // Create a new service instance with the error mock
        const errorService = new ImageProcessingService({
          db: { ...errorMockDb, query: mockDbQuery } as unknown as Database,
          environment: 'test',
          r2Service: testMockR2Service,
          r2PublicUrlBase: 'https://test.r2.dev',
        });

        await expect(
          errorService.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/Database error/i);
      });

      it('should propagate database query errors in delete operations', async () => {
        mockDbQuery.users.findFirst.mockRejectedValue(
          new Error('Database query failed')
        );

        await expect(service.deleteUserAvatar('user-1')).rejects.toThrow(
          /Database query failed/i
        );
      });
    });

    describe('Image Processing Failures', () => {
      it('should handle corrupt image data that processor cannot process', async () => {
        const file = createTestImageFile('image/jpeg', 'corrupt.jpg');

        vi.mocked(processor.processImageVariants).mockImplementation(() => {
          throw new Error('Failed to decode image');
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).rejects.toThrow(/Failed to decode image/i);
      });
    });
  });

  describe('Edge Cases', () => {
    describe('Empty and Minimal Files', () => {
      it('should reject empty files', async () => {
        const emptyFile = new File([], 'empty.jpg', { type: 'image/jpeg' });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', emptyFile)
        ).rejects.toThrow(/empty|size|invalid/i);
      });

      it('should reject files smaller than minimum magic byte length', async () => {
        const tinyBuffer = new Uint8Array([0xff]).buffer; // Only 1 byte
        const tinyFile = new File([tinyBuffer], 'tiny.jpg', {
          type: 'image/jpeg',
        });

        await expect(
          service.processUserAvatar('user-1', tinyFile)
        ).rejects.toThrow(/invalid.*signature|too small/i);
      });
    });

    describe('SVG Special Cases', () => {
      it('should handle very small SVG files', async () => {
        const minimalSvg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
        const encoder = new TextEncoder();
        const file = new File([encoder.encode(minimalSvg)], 'minimal.svg', {
          type: 'image/svg+xml',
        });

        const result = await service.processOrgLogo('org-1', 'user-1', file);

        expect(result.mimeType).toBe('image/svg+xml');
        expect(testMockR2Service.put).toHaveBeenCalledTimes(1);
      });

      it('should sanitize SVG by removing script tags', async () => {
        // Mock sanitizeSvgContent to simulate real sanitization (strips <script>)
        const { sanitizeSvgContent: mockedSanitize } = await import(
          '@codex/validation'
        );
        vi.mocked(mockedSanitize).mockImplementationOnce(
          async (svgText: string) => {
            // Simulate DOMPurify stripping <script> tags
            return svgText.replace(/<script[^>]*>.*?<\/script>/gi, '');
          }
        );

        const maliciousSvg =
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
        const encoder = new TextEncoder();
        const file = new File([encoder.encode(maliciousSvg)], 'evil.svg', {
          type: 'image/svg+xml',
        });

        const result = await service.processOrgLogo('org-1', 'user-1', file);

        expect(result.mimeType).toBe('image/svg+xml');

        // Verify the uploaded content was sanitized (no script tag)
        const putCall = vi.mocked(testMockR2Service.put).mock.calls[0];
        const uploadedBytes = putCall[1] as Uint8Array;
        const uploadedSvg = new TextDecoder().decode(uploadedBytes);
        expect(uploadedSvg).not.toContain('<script');
        expect(uploadedSvg).toContain('rect');
      });

      it('should handle SVG with complex content', async () => {
        const complexSvg =
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/><path d="M10,10 L90,90"/></svg>';
        const encoder = new TextEncoder();
        const file = new File([encoder.encode(complexSvg)], 'complex.svg', {
          type: 'image/svg+xml',
        });

        const result = await service.processOrgLogo('org-1', 'user-1', file);

        expect(result.mimeType).toBe('image/svg+xml');
        expect(result.url).toContain('logo.svg');
      });
    });

    describe('Unusual Filenames', () => {
      it('should handle files with special characters in names', async () => {
        const file = createTestImageFile('image/png', 'my file (copy) [2].png');

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        await expect(
          service.processContentThumbnail('content-1', 'user-1', file)
        ).resolves.not.toThrow();
      });

      it('should handle files with Unicode characters in names', async () => {
        const file = createTestImageFile('image/jpeg', '图片-测试.jpg');

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        await expect(
          service.processUserAvatar('user-1', file)
        ).resolves.not.toThrow();
      });
    });

    describe('GIF and WebP Format Handling', () => {
      it('should process GIF files correctly', async () => {
        // GIF89a magic bytes
        const gifBuffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
          .buffer;
        const file = new File([gifBuffer], 'animated.gif', {
          type: 'image/gif',
        });

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

        expect(result.mimeType).toBe('image/webp');
        expect(testMockR2Service.put).toHaveBeenCalledTimes(3);
      });

      it('should process WebP files correctly', async () => {
        // WebP magic bytes (RIFF____WEBP)
        const webpBuffer = new Uint8Array([
          0x52,
          0x49,
          0x46,
          0x46, // RIFF
          0x00,
          0x00,
          0x00,
          0x00, // Size placeholder
          0x57,
          0x45,
          0x42,
          0x50, // WEBP
        ]).buffer;
        const file = new File([webpBuffer], 'image.webp', {
          type: 'image/webp',
        });

        vi.mocked(processor.processImageVariants).mockReturnValueOnce({
          sm: new Uint8Array([1]),
          md: new Uint8Array([2]),
          lg: new Uint8Array([3]),
        });

        const result = await service.processUserAvatar('user-1', file);

        expect(result.mimeType).toBe('image/webp');
        expect(processor.processImageVariants).toHaveBeenCalled();
      });
    });
  });
});
