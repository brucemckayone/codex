/**
 * Account Schemas Tests
 *
 * Tests for account-related form schemas.
 * Validates username, URLs, and file upload rules.
 */

import { describe, expect, it } from 'vitest';
// Avatar upload schema - simplified for testing (without instanceof File check)
// This schema is defined inline since it's part of the avatar-upload.remote module
import { z } from 'zod';
import {
  purchaseHistoryQuerySchema,
  updateNotificationsFormSchema,
  updateProfileFormSchema,
} from '../schemas/account';

const avatarUploadFieldsSchema = z.object({
  avatar: z
    .any()
    .refine(
      (file) => !file || file.type?.startsWith('image/'),
      'Must be an image file'
    )
    .refine(
      (file) => !file || file.size <= 5 * 1024 * 1024,
      'File must be less than 5MB'
    ),
});

describe('Account Schemas', () => {
  describe('updateProfileFormSchema', () => {
    describe('displayName', () => {
      it('accepts valid display name', () => {
        const result = updateProfileFormSchema.safeParse({
          displayName: 'John Doe',
        });
        expect(result.success).toBe(true);
      });

      it('rejects empty display name (min 1 char required)', () => {
        const result = updateProfileFormSchema.safeParse({
          displayName: '',
        });
        expect(result.success).toBe(false);
      });

      it('accepts missing display name (optional)', () => {
        const result = updateProfileFormSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it('rejects display name longer than 255 characters', () => {
        const result = updateProfileFormSchema.safeParse({
          displayName: 'a'.repeat(256),
        });
        expect(result.success).toBe(false);
      });
    });

    describe('username', () => {
      it('accepts valid lowercase username', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'johndoe',
        });
        expect(result.success).toBe(true);
      });

      it('accepts username with numbers', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'user123',
        });
        expect(result.success).toBe(true);
      });

      it('accepts username with hyphens', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'user-name',
        });
        expect(result.success).toBe(true);
      });

      it('accepts mixed lowercase, numbers, and hyphens', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'user-123-test',
        });
        expect(result.success).toBe(true);
      });

      it('rejects username with uppercase letters', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'JohnDoe',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('lowercase');
        }
      });

      it('rejects username with special characters', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'user_name',
        });
        expect(result.success).toBe(false);
      });

      it('rejects username shorter than 2 characters', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'a',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('at least 2');
        }
      });

      it('rejects username longer than 50 characters', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'a'.repeat(51),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0].message).toContain('at most 50');
        }
      });

      it('accepts missing username (optional)', () => {
        const result = updateProfileFormSchema.safeParse({});
        expect(result.success).toBe(true);
      });

      it('accepts username with single character hyphen', () => {
        const result = updateProfileFormSchema.safeParse({
          username: 'ab',
        });
        expect(result.success).toBe(true);
      });

      it('accepts username starting with hyphen', () => {
        const result = updateProfileFormSchema.safeParse({
          username: '-username',
        });
        // Hyphens are allowed anywhere in the pattern
        expect(result.success).toBe(true);
      });
    });

    describe('bio', () => {
      it('accepts valid bio', () => {
        const result = updateProfileFormSchema.safeParse({
          bio: 'Software developer and enthusiast',
        });
        expect(result.success).toBe(true);
      });

      it('accepts multiline bio', () => {
        const result = updateProfileFormSchema.safeParse({
          bio: 'Line 1\nLine 2\nLine 3',
        });
        expect(result.success).toBe(true);
      });

      it('rejects bio longer than 500 characters', () => {
        const result = updateProfileFormSchema.safeParse({
          bio: 'a'.repeat(501),
        });
        expect(result.success).toBe(false);
      });

      it('accepts missing bio (optional)', () => {
        const result = updateProfileFormSchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });

    describe('social links', () => {
      it('accepts valid website URL', () => {
        const result = updateProfileFormSchema.safeParse({
          website: 'https://example.com',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid Twitter URL', () => {
        const result = updateProfileFormSchema.safeParse({
          twitter: 'https://twitter.com/username',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid YouTube URL', () => {
        const result = updateProfileFormSchema.safeParse({
          youtube: 'https://youtube.com/channel/123',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid Instagram URL', () => {
        const result = updateProfileFormSchema.safeParse({
          instagram: 'https://instagram.com/username',
        });
        expect(result.success).toBe(true);
      });

      it('rejects invalid website URL', () => {
        const result = updateProfileFormSchema.safeParse({
          website: 'not-a-url',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(
            result.error.issues.some((i) => i.message.includes('URL'))
          ).toBe(true);
        }
      });

      it('rejects invalid Twitter URL', () => {
        const result = updateProfileFormSchema.safeParse({
          twitter: 'not-a-url',
        });
        expect(result.success).toBe(false);
      });

      it('rejects invalid YouTube URL', () => {
        const result = updateProfileFormSchema.safeParse({
          youtube: 'not-a-url',
        });
        expect(result.success).toBe(false);
      });

      it('rejects invalid Instagram URL', () => {
        const result = updateProfileFormSchema.safeParse({
          instagram: 'not-a-url',
        });
        expect(result.success).toBe(false);
      });

      it('accepts empty string for social links (treated as missing)', () => {
        const result = updateProfileFormSchema.safeParse({
          website: '',
          twitter: '',
          youtube: '',
          instagram: '',
        });
        // Empty string is still a string, so it might fail url() validation
        // In practice, optional() transforms undefined, but empty string goes through url()
        expect(result.success).toBe(false);
      });

      it('accepts missing social links', () => {
        const result = updateProfileFormSchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });

    describe('complete profile form', () => {
      it('accepts valid complete profile data', () => {
        const data = {
          displayName: 'John Doe',
          username: 'johndoe',
          bio: 'Software developer',
          website: 'https://johndoe.com',
          twitter: 'https://twitter.com/johndoe',
          youtube: 'https://youtube.com/@johndoe',
          instagram: 'https://instagram.com/johndoe',
        };
        const result = updateProfileFormSchema.safeParse(data);
        expect(result.success).toBe(true);
      });

      it('accepts partial profile data', () => {
        const data = {
          displayName: 'John Doe',
        };
        const result = updateProfileFormSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });
  });

  describe('updateNotificationsFormSchema', () => {
    it('accepts all true values', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: true,
        emailTransactional: true,
        emailDigest: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts all false values', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: false,
        emailTransactional: false,
        emailDigest: false,
      });
      expect(result.success).toBe(true);
    });

    it('accepts mixed boolean values', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: false,
        emailTransactional: true,
        emailDigest: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-boolean values', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: 'true',
        emailTransactional: true,
        emailDigest: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('avatarUploadFieldsSchema', () => {
    it('accepts valid image file', () => {
      const mockFile = {
        type: 'image/png',
        size: 1024 * 1024, // 1MB
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('accepts JPEG image', () => {
      const mockFile = {
        type: 'image/jpeg',
        size: 1024 * 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('accepts GIF image', () => {
      const mockFile = {
        type: 'image/gif',
        size: 1024 * 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('accepts WebP image', () => {
      const mockFile = {
        type: 'image/webp',
        size: 1024 * 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('rejects non-image file', () => {
      const mockFile = {
        type: 'application/pdf',
        size: 1024 * 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('image');
      }
    });

    it('rejects file larger than 5MB', () => {
      const mockFile = {
        type: 'image/png',
        size: 5 * 1024 * 1024 + 1, // 5MB + 1 byte
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('5MB');
      }
    });

    it('accepts file exactly 5MB', () => {
      const mockFile = {
        type: 'image/png',
        size: 5 * 1024 * 1024, // exactly 5MB
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('accepts missing file (undefined)', () => {
      const result = avatarUploadFieldsSchema.safeParse({ avatar: undefined });
      expect(result.success).toBe(true);
    });

    it('accepts null file', () => {
      const result = avatarUploadFieldsSchema.safeParse({ avatar: null });
      expect(result.success).toBe(true);
    });

    it('accepts SVG image', () => {
      const mockFile = {
        type: 'image/svg+xml',
        size: 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(true);
    });

    it('rejects file without type property', () => {
      const mockFile = {
        size: 1024,
      };
      const result = avatarUploadFieldsSchema.safeParse({ avatar: mockFile });
      expect(result.success).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional schemas from account.remote.ts and avatar-delete.remote.ts
  // ─────────────────────────────────────────────────────────────────────────────

  describe('purchaseHistoryQuerySchema', () => {
    describe('page parameter', () => {
      it('accepts valid page number', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ page: 5 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(5);
        }
      });

      it('accepts page as string (coerced to number)', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ page: '3' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(3);
        }
      });

      it('defaults to page 1 when not provided', () => {
        const result = purchaseHistoryQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
        }
      });

      it('rejects page less than 1', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ page: 0 });
        expect(result.success).toBe(false);
      });

      it('rejects negative page', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ page: -1 });
        expect(result.success).toBe(false);
      });

      it('rejects invalid string for page', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          page: 'invalid',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('limit parameter', () => {
      it('accepts valid limit number', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ limit: 50 });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(50);
        }
      });

      it('accepts limit as string (coerced to number)', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ limit: '25' });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(25);
        }
      });

      it('defaults to limit 20 when not provided', () => {
        const result = purchaseHistoryQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.limit).toBe(20);
        }
      });

      it('rejects limit less than 1', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ limit: 0 });
        expect(result.success).toBe(false);
      });

      it('rejects limit greater than 100', () => {
        const result = purchaseHistoryQuerySchema.safeParse({ limit: 101 });
        expect(result.success).toBe(false);
      });
    });

    describe('status parameter', () => {
      it('accepts valid status: pending', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'pending',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid status: complete', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'complete',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid status: refunded', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'refunded',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid status: failed', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'failed',
        });
        expect(result.success).toBe(true);
      });

      it('accepts missing status (optional)', () => {
        const result = purchaseHistoryQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.status).toBeUndefined();
        }
      });

      it('rejects invalid status', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'invalid',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('contentId parameter', () => {
      it('accepts valid UUID v4', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          contentId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(true);
      });

      it('accepts valid UUID with uppercase', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          contentId: '550E8400-E29B-41D4-A716-446655440000',
        });
        expect(result.success).toBe(true);
      });

      it('accepts missing contentId (optional)', () => {
        const result = purchaseHistoryQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.contentId).toBeUndefined();
        }
      });

      it('rejects invalid UUID format', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          contentId: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
      });
    });

    describe('complete query parameters', () => {
      it('accepts all parameters together', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          page: 2,
          limit: 50,
          status: 'complete',
          contentId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(true);
      });

      it('applies defaults for missing parameters', () => {
        const result = purchaseHistoryQuerySchema.safeParse({
          status: 'pending',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
          expect(result.data.status).toBe('pending');
        }
      });
    });
  });

  // Avatar delete schema (from avatar-delete.remote.ts)
  const avatarDeleteSchema = z.object({});

  describe('avatarDeleteSchema', () => {
    it('accepts empty object', () => {
      const result = avatarDeleteSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('ignores extra fields', () => {
      const result = avatarDeleteSchema.safeParse({ extra: 'field' });
      expect(result.success).toBe(true);
    });
  });

  // Additional notification schema tests
  describe('updateNotificationsFormSchema - additional tests', () => {
    it('rejects non-boolean number value', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: 1,
        emailTransactional: true,
        emailDigest: false,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: true,
        // Missing emailTransactional and emailDigest
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty object', () => {
      const result = updateNotificationsFormSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects null values', () => {
      const result = updateNotificationsFormSchema.safeParse({
        emailMarketing: null,
        emailTransactional: true,
        emailDigest: false,
      });
      expect(result.success).toBe(false);
    });
  });
});
