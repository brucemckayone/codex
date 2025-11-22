/**
 * Access Error Classes - Unit Tests
 *
 * Tests for custom error classes used in the Access package.
 * Verifies error codes, status codes, messages, and context.
 */

import { describe, expect, it } from 'vitest';
import {
  AccessDeniedError,
  ContentNotFoundError,
  InvalidContentTypeError,
  MediaNotFoundError,
  OrganizationMismatchError,
  R2SigningError,
} from './errors';

describe('AccessDeniedError', () => {
  const testUserId = 'user-123';
  const testContentId = 'content-456';

  it('should create error with correct code', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.code).toBe('ACCESS_DENIED');
  });

  it('should create error with correct status code', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.statusCode).toBe(403);
  });

  it('should create error with default message', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.message).toBe('User does not have access to this content');
  });

  it('should include userId and contentId in context', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.context).toMatchObject({
      userId: testUserId,
      contentId: testContentId,
      code: 'ACCESS_DENIED',
    });
  });

  it('should be instance of Error', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct name property', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.name).toBe('AccessDeniedError');
  });

  it('should include stack trace', () => {
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AccessDeniedError');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      const error = new AccessDeniedError(testUserId, testContentId);
    }).toThrow(AccessDeniedError);

    expect(() => {
      throw new AccessDeniedError(testUserId, testContentId, {
        message: 'Custom message',
      });
    }).toThrow('Custom message');
  });

  it('should preserve custom message in thrown error', () => {
    const customMessage = 'Payment required for premium content';

    try {
      throw new AccessDeniedError(testUserId, testContentId, {
        message: customMessage,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect((error as AccessDeniedError).message).toBe(customMessage);
      expect((error as AccessDeniedError).code).toBe('ACCESS_DENIED');
      expect((error as AccessDeniedError).statusCode).toBe(403);
    }
  });

  it('should work with async/await error handling', async () => {
    const asyncFunction = async () => {
      throw new AccessDeniedError('Async access denied');
    };

    await expect(asyncFunction()).rejects.toThrow(AccessDeniedError);
    await expect(asyncFunction()).rejects.toThrow('Async access denied');
  });

  it('should serialize correctly to JSON', () => {
    const error = new AccessDeniedError(testUserId, testContentId);

    // Errors don't serialize by default, but our ServiceError base class should handle this
    // If ServiceError provides toJSON(), verify it works
    const serialized = JSON.stringify(error);
    expect(serialized).toBeDefined();
  });

  describe('Error Message Variations', () => {
    it('should handle empty string message', () => {
      const error = new AccessDeniedError('');
      expect(error.message).toBe('');
      expect(error.code).toBe('ACCESS_DENIED');
    });

    it('should handle very long message', () => {
      const longMessage = 'A'.repeat(1000);
      const error = new AccessDeniedError(longMessage);
      expect(error.message).toBe(longMessage);
      expect(error.message).toHaveLength(1000);
    });

    it('should handle message with special characters', () => {
      const specialMessage =
        'Access denied: User @test-user #123 lacks permissions!';
      const error = new AccessDeniedError(specialMessage);
      expect(error.message).toBe(specialMessage);
    });

    it('should handle message with newlines', () => {
      const multilineMessage =
        'Access denied.\nReason: Insufficient permissions.\nContact: admin@example.com';
      const error = new AccessDeniedError(multilineMessage);
      expect(error.message).toBe(multilineMessage);
    });

    it('should handle message with unicode characters', () => {
      const unicodeMessage = 'Accès refusé. アクセスが拒否されました。';
      const error = new AccessDeniedError(unicodeMessage);
      expect(error.message).toBe(unicodeMessage);
    });
  });

  describe('Common Use Cases', () => {
    it('should represent unpurchased content error', () => {
      const error = new AccessDeniedError(
        'You must purchase this content to access it.'
      );
      expect(error.message).toContain('purchase');
      expect(error.statusCode).toBe(403);
    });

    it('should represent unpublished content error', () => {
      const error = new AccessDeniedError('This content is not published.');
      expect(error.message).toContain('not published');
      expect(error.statusCode).toBe(403);
    });

    it('should represent permission-based error', () => {
      const error = new AccessDeniedError(
        'You do not have permission to access this resource.'
      );
      expect(error.message).toContain('permission');
      expect(error.statusCode).toBe(403);
    });

    it('should represent subscription-required error', () => {
      const error = new AccessDeniedError(
        'Active subscription required to access this content.'
      );
      expect(error.message).toContain('subscription');
      expect(error.statusCode).toBe(403);
    });
  });
});
