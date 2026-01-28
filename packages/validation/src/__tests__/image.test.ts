import { describe, expect, it } from 'vitest';
import { validateImageSignature, validateImageUpload } from '../image';
import { MAX_IMAGE_SIZE_BYTES } from '../limits';

describe('Image Validation', () => {
  describe('validateImageSignature', () => {
    it('should validate PNG signature', () => {
      const pngSignature = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(validateImageSignature(pngSignature, 'image/png')).toBe(true);
    });

    it('should validate JPEG signature', () => {
      const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff]);
      expect(validateImageSignature(jpegSignature, 'image/jpeg')).toBe(true);
    });

    it('should validate WebP signature', () => {
      const webpSignature = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00, // Size (placeholder)
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      expect(validateImageSignature(webpSignature, 'image/webp')).toBe(true);
    });

    it('should validate GIF signature', () => {
      const gifSignature = new Uint8Array([0x47, 0x49, 0x46, 0x38]); // GIF8
      expect(validateImageSignature(gifSignature, 'image/gif')).toBe(true);
    });

    it('should validate SVG XML signature', () => {
      const svgSignature = new Uint8Array([0x3c, 0x3f, 0x78, 0x6d, 0x6c]); // <?xml
      expect(validateImageSignature(svgSignature, 'image/svg+xml')).toBe(true);
    });

    it('should validate SVG tag signature', () => {
      const svgSignature = new Uint8Array([0x3c, 0x73, 0x76, 0x67]); // <svg
      expect(validateImageSignature(svgSignature, 'image/svg+xml')).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const invalidSignature = new Uint8Array([0x00, 0x00, 0x00]);
      expect(validateImageSignature(invalidSignature, 'image/png')).toBe(false);
    });

    it('should reject spoofed extensions (PNG content as JPEG)', () => {
      const pngSignature = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      expect(validateImageSignature(pngSignature, 'image/jpeg')).toBe(false);
    });
  });

  describe('validateImageUpload', () => {
    it('should accept valid PNG upload', async () => {
      const pngBuffer = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]).buffer;
      const file = new File([pngBuffer], 'test.png', { type: 'image/png' });
      const formData = new FormData();
      formData.append('image', file);

      const result = await validateImageUpload(formData, {
        allowedMimeTypes: ['image/png'],
      });

      expect(result.mimeType).toBe('image/png');
      expect(result.size).toBe(8);
    });

    it('should reject file exceeding default size limit', async () => {
      const largeFile = new File(
        [new ArrayBuffer(MAX_IMAGE_SIZE_BYTES + 1)],
        'large.png',
        { type: 'image/png' }
      );
      const formData = new FormData();
      formData.append('image', largeFile);

      await expect(
        validateImageUpload(formData, {
          allowedMimeTypes: ['image/png'],
        })
      ).rejects.toThrow('File too large');
    });

    it('should reject file exceeding custom size limit', async () => {
      const largeFile = new File([new ArrayBuffer(100)], 'large.png', {
        type: 'image/png',
      });
      const formData = new FormData();
      formData.append('image', largeFile);

      await expect(
        validateImageUpload(formData, {
          allowedMimeTypes: ['image/png'],
          maxSizeBytes: 50, // 50 bytes
        })
      ).rejects.toThrow('File too large');
    });

    it('should reject disallowed mime type', async () => {
      const pngBuffer = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]).buffer;
      const file = new File([pngBuffer], 'test.png', { type: 'image/png' });
      const formData = new FormData();
      formData.append('image', file);

      await expect(
        validateImageUpload(formData, {
          allowedMimeTypes: ['image/jpeg'], // only JPEG allowed
        })
      ).rejects.toThrow('Invalid file type');
    });

    it('should reject spoofed file type', async () => {
      // PNG header but claiming to be JPEG
      const pngBuffer = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]).buffer;
      const file = new File([pngBuffer], 'test.jpg', { type: 'image/jpeg' });
      const formData = new FormData();
      formData.append('image', file);

      await expect(
        validateImageUpload(formData, {
          allowedMimeTypes: ['image/jpeg', 'image/png'],
        })
      ).rejects.toThrow('File content does not match claimed MIME type');
    });

    it('should sanitize SVG if requested', async () => {
      const svgContent = '<svg><script>alert(1)</script><rect/></svg>';
      const file = new File([svgContent], 'test.svg', {
        type: 'image/svg+xml',
      });
      const formData = new FormData();
      formData.append('image', file);

      const result = await validateImageUpload(formData, {
        allowedMimeTypes: ['image/svg+xml'],
        sanitizeSvg: true,
      });

      const textDecoder = new TextDecoder();
      const decoded = textDecoder.decode(result.buffer);
      expect(decoded).not.toContain('<script>');
      expect(decoded).toContain('<rect');
    });
  });
});
