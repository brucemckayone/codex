import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { ImageProcessingResult } from '@codex/image-processing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserNotFoundError } from '../errors';
import { IdentityService } from '../services/identity-service';

/**
 * Creates a File object with proper ArrayBuffer content for testing
 */
function createTestImageFile(mimeType: string, filename: string): File {
  // JPEG signature
  const jpegBuffer = new Uint8Array([0xff, 0xd8, 0xff]).buffer;
  return new File([jpegBuffer], filename, { type: mimeType });
}

// Mock dependencies
const mockDb = {
  query: {
    users: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
} as unknown as Database;

// Mock R2Service
const mockR2Service = {
  put: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
} as unknown as R2Service;

// Mock ImageProcessingService - use a factory that creates instances with mock methods
const mockProcessUserAvatar = vi.fn();

vi.mock('@codex/image-processing', () => ({
  ImageProcessingService: class {
    processUserAvatar = mockProcessUserAvatar;
  },
  // Preserve other exports
  extractMimeType: (mimeType: string) => mimeType,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  SUPPORTED_MIME_TYPES: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
  ],
  validateImageSignature: vi.fn(() => true),
  validateImageUpload: vi.fn(),
  ImageUploadError: class extends Error {},
  InvalidImageError: class extends Error {},
}));

describe('IdentityService', () => {
  let service: IdentityService;
  const mockUpdateSet = vi.fn();
  const mockUpdateWhere = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessUserAvatar.mockClear();

    // Setup DB update mock chain
    (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: mockUpdateSet,
    });
    mockUpdateSet.mockReturnValue({
      where: mockUpdateWhere,
    });

    service = new IdentityService({
      db: mockDb,
      environment: 'test',
      r2Service: mockR2Service,
      r2PublicUrlBase: 'https://cdn-test.revelations.studio',
    });
  });

  describe('uploadAvatar', () => {
    const userId = 'user-123';
    const file = createTestImageFile('image/jpeg', 'avatar.jpg');
    const mockUploadResult: ImageProcessingResult = {
      url: `https://cdn-test.revelations.studio/avatars/${userId}/lg.webp`,
      size: 1024,
      mimeType: 'image/webp',
    };

    it('should upload avatar and update user record successfully', async () => {
      // Mock user check
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ id: userId });

      // Mock image processing
      mockProcessUserAvatar.mockResolvedValue(mockUploadResult);

      const result = await service.uploadAvatar(userId, file);

      // Verify user existence check
      expect(mockDb.query.users.findFirst).toHaveBeenCalledWith({
        where: expect.anything(), // Complex eq argument matcher
      });

      // Verify image processing delegated to ImageProcessingService
      expect(mockProcessUserAvatar).toHaveBeenCalledWith(userId, file);

      // DB update now handled inside ImageProcessingService, not here
      expect(mockDb.update).not.toHaveBeenCalled();

      expect(result).toEqual(mockUploadResult);
    });

    it('should throw UserNotFoundError if user does not exist', async () => {
      // Mock user not found
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(undefined);

      await expect(service.uploadAvatar(userId, file)).rejects.toThrow(
        UserNotFoundError
      );

      expect(mockProcessUserAvatar).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
