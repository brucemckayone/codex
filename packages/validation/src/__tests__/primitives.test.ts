import { describe, expect, it } from 'vitest';
import { userIdSchema, uuidSchema } from '../primitives';

/**
 * Primitive Validation Schema Tests
 *
 * Tests for basic building block schemas used across the application.
 * Focus on security-critical validation patterns.
 */

describe('userIdSchema', () => {
  /**
   * Better Auth ID Generation Format:
   * - Uses createRandomStringGenerator("a-z", "A-Z", "0-9")
   * - Default size: 32 characters
   * - Character set: alphanumeric only (no hyphens, underscores, or special chars)
   *
   * Source: better-auth/dist/utils-DBbaShi0.mjs
   * ```
   * const generateId = (size) => {
   *   return createRandomStringGenerator("a-z", "A-Z", "0-9")(size || 32);
   * };
   * ```
   */

  describe('valid Better Auth user IDs', () => {
    it('should accept 32-character alphanumeric strings (Better Auth default)', () => {
      // Real-world Better Auth ID example format
      const id = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';
      expect(userIdSchema.parse(id)).toBe(id);
    });

    it('should accept various alphanumeric ID lengths', () => {
      const validIds = [
        'a', // minimum length
        'abc123',
        'ABC123',
        'MixedCaseId123',
        'a'.repeat(32), // Better Auth default length
        'a'.repeat(64), // maximum length
      ];

      validIds.forEach((id) => {
        expect(userIdSchema.parse(id)).toBe(id);
      });
    });

    it('should accept numeric-only strings', () => {
      expect(userIdSchema.parse('12345678')).toBe('12345678');
    });

    it('should accept letter-only strings', () => {
      expect(userIdSchema.parse('abcdefgh')).toBe('abcdefgh');
      expect(userIdSchema.parse('ABCDEFGH')).toBe('ABCDEFGH');
    });
  });

  describe('invalid user IDs', () => {
    it('should reject empty string', () => {
      expect(() => userIdSchema.parse('')).toThrow('User ID is required');
    });

    it('should reject strings exceeding 64 characters', () => {
      const tooLongId = 'a'.repeat(65);
      expect(() => userIdSchema.parse(tooLongId)).toThrow(
        'User ID is too long'
      );
    });

    it('should reject UUIDs (contain hyphens)', () => {
      // UUIDs use hyphens which are not in Better Auth's alphabet
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(() => userIdSchema.parse(uuid)).toThrow('Invalid user ID format');
    });

    it('should reject strings with hyphens', () => {
      expect(() => userIdSchema.parse('user-id')).toThrow(
        'Invalid user ID format'
      );
    });

    it('should reject strings with underscores', () => {
      // Note: nanoid default uses underscores, but Better Auth does NOT
      expect(() => userIdSchema.parse('user_id')).toThrow(
        'Invalid user ID format'
      );
    });

    it('should reject strings with special characters', () => {
      const invalidIds = [
        'user@id', // at symbol
        'user.id', // dot
        'user id', // space
        'user/id', // slash
        'user+id', // plus
        'user=id', // equals
      ];

      invalidIds.forEach((id) => {
        expect(() => userIdSchema.parse(id)).toThrow('Invalid user ID format');
      });
    });

    it('should reject SQL injection attempts', () => {
      const sqlInjectionAttempts = [
        "'; DROP TABLE users; --",
        '1 OR 1=1',
        'admin"--',
        "' UNION SELECT * FROM users--",
      ];

      sqlInjectionAttempts.forEach((attempt) => {
        expect(() => userIdSchema.parse(attempt)).toThrow();
      });
    });

    it('should reject XSS attempts', () => {
      const xssAttempts = [
        '<script>alert(1)</script>',
        'javascript:alert(1)',
        '"><script>alert(1)</script>',
      ];

      xssAttempts.forEach((attempt) => {
        expect(() => userIdSchema.parse(attempt)).toThrow();
      });
    });

    it('should reject path traversal attempts', () => {
      const pathTraversalAttempts = ['../../../etc/passwd', '..\\windows\\'];

      pathTraversalAttempts.forEach((attempt) => {
        expect(() => userIdSchema.parse(attempt)).toThrow();
      });
    });

    it('should reject non-string types', () => {
      expect(() => userIdSchema.parse(12345)).toThrow();
      expect(() => userIdSchema.parse(null)).toThrow();
      expect(() => userIdSchema.parse(undefined)).toThrow();
      expect(() => userIdSchema.parse({ id: 'abc' })).toThrow();
      expect(() => userIdSchema.parse(['abc'])).toThrow();
    });
  });

  describe('type inference', () => {
    it('should infer string type', () => {
      const parsed: string = userIdSchema.parse('validUserId123');
      expect(typeof parsed).toBe('string');
    });
  });
});

describe('uuidSchema vs userIdSchema', () => {
  /**
   * These schemas are for DIFFERENT use cases:
   * - uuidSchema: For content IDs, organization IDs, media IDs (UUID format)
   * - userIdSchema: For Better Auth user IDs (alphanumeric format)
   *
   * The Codex platform uses UUIDs for most entity IDs but Better Auth
   * generates alphanumeric IDs for users.
   */

  it('should accept UUIDs in uuidSchema but reject in userIdSchema', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';

    // UUID schema accepts UUIDs
    expect(uuidSchema.parse(uuid)).toBe(uuid);

    // User ID schema rejects UUIDs (contains hyphens)
    expect(() => userIdSchema.parse(uuid)).toThrow('Invalid user ID format');
  });

  it('should accept Better Auth IDs in userIdSchema but reject in uuidSchema', () => {
    const betterAuthId = 'GV762T8n0fCnqy3qxRvoMjJZ7hTTd44b';

    // User ID schema accepts Better Auth IDs
    expect(userIdSchema.parse(betterAuthId)).toBe(betterAuthId);

    // UUID schema rejects Better Auth IDs (not UUID format)
    expect(() => uuidSchema.parse(betterAuthId)).toThrow('Invalid ID format');
  });
});
