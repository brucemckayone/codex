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
} as unknown as R2Service;

// Mock processor
vi.mock('../processor', () => ({
  processImageVariants: vi.fn(),
}));

describe('ImageProcessingService', () => {
  let service: ImageProcessingService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new ImageProcessingService({
      db: mockDb,
      environment: 'test',
      r2Service: mockR2Service,
      r2PublicUrlBase: 'https://test.r2.dev',
    });
  });

  it('should process content thumbnail (raster) and upload variants', async () => {
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
    expect(result.url).toContain('.s3.amazonaws.com/');
    expect(result.size).toBe(1); // lg variant is Uint8Array([3]), byteLength is 1
    expect(result.mimeType).toBe('image/png');
    expect(mockR2Service.put).toHaveBeenCalledTimes(3);

    // Verify one of the calls
    expect(mockR2Service.put).toHaveBeenCalledWith(
      expect.stringContaining('/sm.webp'),
      expect.any(Uint8Array),
      undefined,
      { contentType: 'image/webp' }
    );
  });

  it('should process org logo (SVG)', async () => {
    const file = createTestImageFile('image/svg+xml', 'logo.svg');

    const result = await service.processOrgLogo('org-1', 'user-1', file);
    // Should NOT call processor for SVG
    expect(processor.processImageVariants).not.toHaveBeenCalled();

    expect(result.url).toContain('logo.svg');
    expect(result.url).toContain('.s3.amazonaws.com/');
    expect(result.mimeType).toBe('image/svg+xml');
    expect(mockR2Service.put).toHaveBeenCalledTimes(1);
    expect(mockR2Service.put).toHaveBeenCalledWith(
      expect.stringContaining('logo.svg'),
      expect.any(Uint8Array),
      { contentType: 'image/svg+xml' }
    );
  });
});
