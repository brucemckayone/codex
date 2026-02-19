import type { R2Service } from '@codex/cloudflare-clients';
import type { Database } from '@codex/database';
import type { ImageProcessingResult } from '@codex/image-processing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserNotFoundError, UsernameTakenError } from '../errors';
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
    organizationMemberships: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
  insert: vi.fn(),
} as unknown as Database;

// Mock returning function for the update chain
const mockReturning = vi.fn();

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
    // Clear specific mocks
    (mockDb.query.users.findFirst as ReturnType<typeof vi.fn>).mockClear();
    (
      mockDb.query.organizationMemberships.findFirst as ReturnType<typeof vi.fn>
    ).mockClear();
    (mockDb.update as ReturnType<typeof vi.fn>).mockClear();
    (mockDb.insert as ReturnType<typeof vi.fn>).mockClear();
    mockUpdateSet.mockClear();
    mockUpdateWhere.mockClear();
    mockReturning.mockClear();
    mockProcessUserAvatar.mockClear();

    // Setup DB update mock chain
    (mockDb.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: mockUpdateSet,
    });
    mockUpdateSet.mockReturnValue({
      where: mockUpdateWhere,
    });
    mockUpdateWhere.mockReturnValue({
      returning: mockReturning,
    });
    mockReturning.mockResolvedValue([{ id: 'user-123' }]); // Default

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

  describe('updateProfile', () => {
    const userId = 'user-123';

    it('should update displayName (name field)', async () => {
      const existingUser = {
        id: userId,
        name: 'Old Name',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
      };

      // Mock existing user
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      // Mock update result
      const updatedUser = {
        ...existingUser,
        name: 'New Display Name',
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        displayName: 'New Display Name',
      });

      // Verify user was fetched
      expect(mockDb.query.users.findFirst).toHaveBeenCalled();

      // Verify update was called with correct data (name maps to displayName)
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Display Name' })
      );

      // Verify result (use objectContaining for resilience against new fields)
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          name: 'New Display Name',
          email: 'user@example.com',
          emailVerified: true,
          image: null,
        })
      );
    });

    it('should update email and set emailVerified to false', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'old@example.com',
        emailVerified: true,
        image: null,
      };

      // Mock existing user
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      // Mock update result
      const updatedUser = {
        ...existingUser,
        email: 'new@example.com',
        emailVerified: false,
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        email: 'new@example.com',
      });

      // Verify update was called with new email and emailVerified set to false
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'new@example.com',
          emailVerified: false,
        })
      );

      // Verify result
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          name: 'Test User',
          email: 'new@example.com',
          emailVerified: false,
          image: null,
        })
      );
    });

    it('should update both displayName and email together', async () => {
      const existingUser = {
        id: userId,
        name: 'Old Name',
        email: 'old@example.com',
        emailVerified: true,
        image: null,
      };

      // Mock existing user
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      // Mock update result
      const updatedUser = {
        ...existingUser,
        name: 'New Name',
        email: 'new@example.com',
        emailVerified: false,
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        displayName: 'New Name',
        email: 'new@example.com',
      });

      // Verify update was called with both fields
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Name',
          email: 'new@example.com',
          emailVerified: false,
        })
      );

      // Verify result
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          name: 'New Name',
          email: 'new@example.com',
          emailVerified: false,
          image: null,
        })
      );
    });

    it('should not set emailVerified to false if email is unchanged', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'same@example.com',
        emailVerified: true,
        image: null,
      };

      // Mock existing user
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      // Mock update result - emailVerified should remain true
      const updatedUser = {
        ...existingUser,
        name: 'Updated Name',
      };
      mockReturning.mockResolvedValue([updatedUser]);

      await service.updateProfile(userId, {
        displayName: 'Updated Name',
        email: 'same@example.com', // Same email
      });

      // Verify update was called with only name, not email
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Updated Name',
        })
      );

      // emailVerified should not be in the update set
      const updateCallArg = mockUpdateSet.mock.calls[0][0];
      expect(updateCallArg).not.toHaveProperty('email');
      expect(updateCallArg).not.toHaveProperty('emailVerified');
    });

    it('should throw UserNotFoundError if user does not exist', async () => {
      // Mock user not found
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(undefined);

      await expect(
        service.updateProfile(userId, { displayName: 'New Name' })
      ).rejects.toThrow(UserNotFoundError);

      // Update should not be called
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should handle empty update object', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
      };

      // Mock existing user
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      // Mock update result - no changes
      mockReturning.mockResolvedValue([existingUser]);

      const result = await service.updateProfile(userId, {});

      // Verify update was called with empty object (no-op update)
      expect(mockUpdateSet).toHaveBeenCalledWith({});

      // Verify result unchanged
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          name: 'Test User',
          email: 'user@example.com',
          emailVerified: true,
          image: null,
        })
      );
    });

    it('should update username', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      // Track the call count to differentiate the initial user fetch from the uniqueness check
      let callCount = 0;
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callCount++;
        // First call: fetch existing user
        if (callCount === 1) {
          return Promise.resolve(existingUser);
        }
        // Second call: uniqueness check - no conflict
        return Promise.resolve(null);
      });

      const updatedUser = {
        ...existingUser,
        username: 'testuser',
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        username: 'testuser',
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          username: 'testuser',
        })
      );
    });

    it('should throw UsernameTakenError if username is taken', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      const otherUser = {
        id: 'other-user-id',
        name: 'Other User',
        email: 'other@example.com',
        emailVerified: true,
        image: null,
        username: 'takenusername',
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      // Track the call count to differentiate the initial user fetch from the uniqueness check
      let callCount = 0;
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callCount++;
        // First call: fetch existing user
        if (callCount === 1) {
          return Promise.resolve(existingUser);
        }
        // Second call: uniqueness check returns another user with the username
        return Promise.resolve(otherUser);
      });

      await expect(
        service.updateProfile(userId, { username: 'takenusername' })
      ).rejects.toThrow(UsernameTakenError);
    });

    it('should clear username by setting to null', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: 'oldusername',
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      const updatedUser = {
        ...existingUser,
        username: null,
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        username: null,
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          username: null,
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          username: null,
        })
      );
    });

    it('should allow username reuse after soft-delete', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      // Track the call count to differentiate calls
      let callCount = 0;
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callCount++;
        // First call: fetch existing user
        if (callCount === 1) {
          return Promise.resolve(existingUser);
        }
        // Second call: uniqueness check returns null
        // (simulating that the DB filtered out soft-deleted users with isNull(deletedAt))
        return Promise.resolve(null);
      });

      const updatedUser = {
        ...existingUser,
        username: 'reusableusername',
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        username: 'reusableusername',
      });

      // Should succeed - username can be reused from soft-deleted user
      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'reusableusername',
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: userId,
          username: 'reusableusername',
        })
      );
    });

    it('should update bio', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      const updatedUser = {
        ...existingUser,
        bio: 'This is my bio',
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        bio: 'This is my bio',
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          bio: 'This is my bio',
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          bio: 'This is my bio',
        })
      );
    });

    it('should update socialLinks', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(existingUser);

      const socialLinksInput = {
        website: 'https://example.com',
        twitter: 'https://twitter.com/testuser',
      };

      const updatedUser = {
        ...existingUser,
        socialLinks: socialLinksInput,
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        socialLinks: socialLinksInput,
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          socialLinks: socialLinksInput,
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          socialLinks: socialLinksInput,
        })
      );
    });

    it('should update all new fields together', async () => {
      const existingUser = {
        id: userId,
        name: 'Test User',
        email: 'user@example.com',
        emailVerified: true,
        image: null,
        username: null,
        bio: null,
        socialLinks: null,
        deletedAt: null,
      };

      // Track the call count to differentiate the initial user fetch from the uniqueness check
      let callCount = 0;
      (
        mockDb.query.users.findFirst as ReturnType<typeof vi.fn>
      ).mockImplementation(() => {
        callCount++;
        // First call: fetch existing user
        if (callCount === 1) {
          return Promise.resolve(existingUser);
        }
        // Second call: uniqueness check - no conflict
        return Promise.resolve(null);
      });

      const socialLinksInput = {
        website: 'https://example.com',
        twitter: 'https://twitter.com/testuser',
      };

      const updatedUser = {
        ...existingUser,
        username: 'testuser',
        bio: 'Creator of things',
        socialLinks: socialLinksInput,
      };
      mockReturning.mockResolvedValue([updatedUser]);

      const result = await service.updateProfile(userId, {
        username: 'testuser',
        bio: 'Creator of things',
        socialLinks: socialLinksInput,
      });

      expect(mockUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'testuser',
          bio: 'Creator of things',
          socialLinks: socialLinksInput,
        })
      );
      expect(result).toEqual(
        expect.objectContaining({
          username: 'testuser',
          bio: 'Creator of things',
          socialLinks: socialLinksInput,
        })
      );
    });
  });

  describe('getMyMembership', () => {
    const orgId = 'org-123';
    const userId = 'user-123';

    it('should return membership when user is a member', async () => {
      const membership = {
        role: 'admin',
        status: 'active',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };

      (
        mockDb.query.organizationMemberships.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(membership);

      const result = await service.getMyMembership(orgId, userId);

      expect(result).toEqual({
        role: 'admin',
        status: 'active',
        joinedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('should return nulls when user is not a member', async () => {
      (
        mockDb.query.organizationMemberships.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(null);

      const result = await service.getMyMembership(orgId, userId);

      expect(result).toEqual({
        role: null,
        status: null,
        joinedAt: null,
      });
    });

    it('should handle database errors gracefully', async () => {
      (
        mockDb.query.organizationMemberships.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockRejectedValue(new Error('Database connection failed'));

      // handleError wraps unknown errors, so we expect the wrapped message
      await expect(service.getMyMembership(orgId, userId)).rejects.toThrow(
        /unexpected error/i
      );
    });
  });

  describe.skip('getNotificationPreferences', () => {
    const userId = 'user-123';

    it('should insert default preferences on first access', async () => {
      const defaultPrefs = {
        userId,
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      };

      // Mock the entire insert chain inline for this test
      const mockReturning = vi.fn().mockResolvedValue([defaultPrefs]);
      const mockOnConflict = vi
        .fn()
        .mockReturnValue({ returning: mockReturning });
      const mockValues = vi
        .fn()
        .mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      // Directly mock db.insert (same pattern as db.update in lines 80-90)
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockValues);

      const result = await service.getNotificationPreferences(userId);

      expect(result).toEqual({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: defaultPrefs.createdAt,
        updatedAt: defaultPrefs.updatedAt,
      });
    });

    it('should return existing preferences if already set', async () => {
      const existingPrefs = {
        userId,
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z'),
      };

      // Mock the entire insert chain inline for this test
      const mockReturning = vi.fn().mockResolvedValue([existingPrefs]);
      const mockOnConflict = vi
        .fn()
        .mockReturnValue({ returning: mockReturning });
      const mockValues = vi
        .fn()
        .mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      // Directly mock db.insert (same pattern as db.update in lines 80-90)
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockValues);

      const result = await service.getNotificationPreferences(userId);

      expect(result).toEqual({
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
        createdAt: existingPrefs.createdAt,
        updatedAt: existingPrefs.updatedAt,
      });
    });
  });

  describe.skip('updateNotificationPreferences', () => {
    const userId = 'user-123';

    it('should insert with values if not exists', async () => {
      const updatedPrefs = {
        userId,
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z'),
      };

      // Mock the entire insert chain inline for this test
      const mockReturning = vi.fn().mockResolvedValue([updatedPrefs]);
      const mockOnConflict = vi
        .fn()
        .mockReturnValue({ returning: mockReturning });
      const mockValues = vi
        .fn()
        .mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      // Directly mock db.insert (same pattern as db.update in lines 80-90)
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockValues);

      const result = await service.updateNotificationPreferences(userId, {
        emailMarketing: false,
      });

      expect(result).toEqual({
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: true,
        createdAt: updatedPrefs.createdAt,
        updatedAt: updatedPrefs.updatedAt,
      });
    });

    it('should update existing preferences', async () => {
      const updatedPrefs = {
        userId,
        emailMarketing: false,
        emailTransactional: false,
        emailDigest: false,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z'),
      };

      // Mock the entire insert chain inline for this test
      const mockReturning = vi.fn().mockResolvedValue([updatedPrefs]);
      const mockOnConflict = vi
        .fn()
        .mockReturnValue({ returning: mockReturning });
      const mockValues = vi
        .fn()
        .mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      // Directly mock db.insert (same pattern as db.update in lines 80-90)
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockValues);

      const result = await service.updateNotificationPreferences(userId, {
        emailMarketing: false,
        emailTransactional: false,
        emailDigest: false,
      });

      expect(result.emailMarketing).toBe(false);
      expect(result.emailTransactional).toBe(false);
      expect(result.emailDigest).toBe(false);
    });

    it('should update individual fields independently', async () => {
      const updatedPrefs = {
        userId,
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z'),
      };

      // Mock the entire insert chain inline for this test
      const mockReturning = vi.fn().mockResolvedValue([updatedPrefs]);
      const mockOnConflict = vi
        .fn()
        .mockReturnValue({ returning: mockReturning });
      const mockValues = vi
        .fn()
        .mockReturnValue({ onConflictDoUpdate: mockOnConflict });

      // Directly mock db.insert (same pattern as db.update in lines 80-90)
      (mockDb.insert as ReturnType<typeof vi.fn>).mockReturnValue(mockValues);

      // Update only emailMarketing
      const result = await service.updateNotificationPreferences(userId, {
        emailMarketing: false,
      });

      expect(result.emailMarketing).toBe(false);
      expect(result.emailTransactional).toBe(true); // Unchanged
      expect(result.emailDigest).toBe(true); // Unchanged
    });
  });
});
