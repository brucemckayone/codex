import type { R2Bucket } from '@cloudflare/workers-types';
import type { Database } from '@codex/database';
import { users } from '@codex/database/schema';
import type {
  ImageProcessingService,
  ImageUploadResult,
} from '@codex/image-processing';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserNotFoundError } from '../errors';
import { IdentityService } from '../services/identity-service';

// Mock dependencies
const mockDb = {
  query: {
    users: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
} as unknown as Database;

const mockProcessUserAvatar = vi.fn();

vi.mock('@codex/image-processing', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@codex/image-processing')>();
  return {
    ...actual,
    ImageProcessingService: vi.fn().mockImplementation(() => ({
      processUserAvatar: mockProcessUserAvatar,
    })),
  };
});

const mockR2 = {} as R2Bucket;

describe('IdentityService', () => {
  let service: IdentityService;
  const mockUpdateSet = vi.fn();
  const mockUpdateWhere = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup DB update mock chain
    (mockDb.update as any).mockReturnValue({
      set: mockUpdateSet,
    });
    mockUpdateSet.mockReturnValue({
      where: mockUpdateWhere,
    });

    service = new IdentityService({
      db: mockDb,
      environment: 'test',
    });
  });
  describe('uploadAvatar', () => {
    const userId = 'user-123';
    const file = new File(['avatar content'], 'avatar.jpg', {
      type: 'image/jpeg',
    });
    const mockUploadResult: ImageUploadResult = {
      basePath: `avatars/${userId}`,
      urls: {
        sm: `avatars/${userId}/sm.webp`,
        md: `avatars/${userId}/md.webp`,
        lg: `avatars/${userId}/lg.webp`,
      },
    };

    it('should upload avatar and update user record successfully', async () => {
      // Mock user check
      (mockDb.query.users.findFirst as any).mockResolvedValue({ id: userId });

      // Mock image processing
      mockProcessUserAvatar.mockResolvedValue(mockUploadResult);

      const result = await service.uploadAvatar(userId, file, mockR2);

      // Verify user existence check
      expect(mockDb.query.users.findFirst).toHaveBeenCalledWith({
        where: expect.anything(), // Complex eq argument matcher
      });

      // Verify image processing
      expect(mockProcessUserAvatar).toHaveBeenCalledWith(
        userId,
        expect.any(FormData)
      );

      // Verify DB update
      expect(mockDb.update).toHaveBeenCalledWith(users);
      expect(mockUpdateSet).toHaveBeenCalledWith({
        avatarUrl: mockUploadResult.basePath,
        updatedAt: expect.any(Date),
      });
      expect(mockUpdateWhere).toHaveBeenCalledWith(eq(users.id, userId));

      expect(result).toEqual(mockUploadResult);
    });

    it('should throw UserNotFoundError if user does not exist', async () => {
      // Mock user not found
      (mockDb.query.users.findFirst as any).mockResolvedValue(undefined);

      await expect(service.uploadAvatar(userId, file, mockR2)).rejects.toThrow(
        UserNotFoundError
      );

      expect(mockProcessUserAvatar).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });
});
