import type { R2Bucket } from '@cloudflare/workers-types';
import * as validation from '@codex/validation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as processor from '../processor';
import { ImageProcessingService } from '../service';

// Mock R2Bucket
const mockR2Bucket = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
} as unknown as R2Bucket;

// Mock dependencies
vi.mock('@codex/validation', async (importOriginal) => {
  const actual = await importOriginal<typeof validation>();
  return {
    ...actual,
    validateImageUpload: vi.fn(),
  };
});

vi.mock('../processor', () => ({
  processImageVariants: vi.fn(),
}));

describe('ImageProcessingService', () => {
  let service: ImageProcessingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImageProcessingService({ r2: mockR2Bucket });
  });

  it('should process content thumbnail (raster) and upload variants', async () => {
    const file = new File(['dummy'], 'test.png', { type: 'image/png' });
    const formData = new FormData();
    formData.append('thumbnail', file);

    // Mock validation success
    vi.mocked(validation.validateImageUpload).mockResolvedValueOnce({
      buffer: new ArrayBuffer(8),
      mimeType: 'image/png',
      size: 8,
    });

    // Mock processing success
    vi.mocked(processor.processImageVariants).mockReturnValueOnce({
      sm: new Uint8Array([1]),
      md: new Uint8Array([2]),
      lg: new Uint8Array([3]),
    });

    const result = await service.processContentThumbnail(
      'user-1',
      'content-1',
      formData
    );

    expect(validation.validateImageUpload).toHaveBeenCalled();
    expect(processor.processImageVariants).toHaveBeenCalled();

    expect(result.basePath).toBe('user-1/content-thumbnails/content-1');
    expect(mockR2Bucket.put).toHaveBeenCalledTimes(3);

    // Verify one of the calls
    expect(mockR2Bucket.put).toHaveBeenCalledWith(
      expect.stringContaining('/sm.webp'),
      expect.any(Uint8Array),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/webp' }),
      })
    );
  });

  it('should process org logo (SVG)', async () => {
    const file = new File(['<svg></svg>'], 'logo.svg', {
      type: 'image/svg+xml',
    });
    const formData = new FormData();
    formData.append('logo', file);

    // Mock validation success (returns SVG mime)
    vi.mocked(validation.validateImageUpload).mockResolvedValueOnce({
      buffer: new ArrayBuffer(8), // Content of SVG
      mimeType: 'image/svg+xml',
      size: 8,
    });

    const result = await service.processOrgLogo('org-1', formData);

    expect(validation.validateImageUpload).toHaveBeenCalled();
    // Should NOT call processor for SVG
    expect(processor.processImageVariants).not.toHaveBeenCalled();

    expect(result.basePath).toContain('logo.svg');
    expect(mockR2Bucket.put).toHaveBeenCalledTimes(1);
    expect(mockR2Bucket.put).toHaveBeenCalledWith(
      'org-1/branding/logo/logo.svg',
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: 'image/svg+xml' }),
      })
    );
  });
});
