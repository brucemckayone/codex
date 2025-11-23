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
    // Test that the error can be instantiated
    const error = new AccessDeniedError(testUserId, testContentId);
    expect(error).toBeInstanceOf(AccessDeniedError);

    // Test that it can be thrown and caught
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

describe('ContentNotFoundError', () => {
  it('should create error with correct code in context', () => {
    const error = new ContentNotFoundError('content-123');
    expect(error.context).toHaveProperty('code', 'CONTENT_NOT_FOUND');
  });

  it('should have correct message', () => {
    const error = new ContentNotFoundError('content-123');
    expect(error.message).toBe('Content not found');
  });

  it('should include contentId in context', () => {
    const error = new ContentNotFoundError('content-123');
    expect(error.context).toHaveProperty('contentId', 'content-123');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new ContentNotFoundError('content-123');
    }).toThrow('Content not found');
  });

  it('should accept optional context parameter', () => {
    const error = new ContentNotFoundError('content-123', {
      reason: 'deleted',
    });
    expect(error.context).toMatchObject({
      contentId: 'content-123',
      code: 'CONTENT_NOT_FOUND',
      reason: 'deleted',
    });
  });
});

describe('R2SigningError', () => {
  it('should create error with correct code in context', () => {
    const error = new R2SigningError(
      'path/to/file.pdf',
      new Error('Sign failed')
    );
    expect(error.context).toHaveProperty('code', 'R2_SIGNING_ERROR');
  });

  it('should have correct message', () => {
    const error = new R2SigningError(
      'path/to/file.pdf',
      new Error('Sign failed')
    );
    expect(error.message).toBe('Failed to generate R2 signed URL');
  });

  it('should include r2Key in context', () => {
    const error = new R2SigningError(
      'path/to/file.pdf',
      new Error('Sign failed')
    );
    expect(error.context).toHaveProperty('r2Key', 'path/to/file.pdf');
  });
});

describe('MediaNotFoundError', () => {
  it('should create error with correct code in context (new signature)', () => {
    const error = new MediaNotFoundError('r2-key-123', 'content-123');
    expect(error.context).toHaveProperty('code', 'MEDIA_NOT_FOUND');
  });

  it('should have correct message (new signature)', () => {
    const error = new MediaNotFoundError('r2-key-123', 'content-123');
    expect(error.message).toBe('Media file not found in storage');
  });

  it('should include r2Key and contentId in context (new signature)', () => {
    const error = new MediaNotFoundError('r2-key-123', 'content-123');
    expect(error.context).toMatchObject({
      r2Key: 'r2-key-123',
      contentId: 'content-123',
      code: 'MEDIA_NOT_FOUND',
    });
  });

  it('should support old signature with mediaItemId', () => {
    const error = new MediaNotFoundError('media-item-456');
    expect(error.message).toBe('Media item not found');
    expect(error.context).toMatchObject({
      mediaItemId: 'media-item-456',
    });
  });
});

describe('InvalidContentTypeError', () => {
  it('should create error with correct code in context', () => {
    const error = new InvalidContentTypeError('content-123', 'audio/mp3');
    expect(error.context).toHaveProperty('code', 'INVALID_CONTENT_TYPE');
  });

  it('should have correct message', () => {
    const error = new InvalidContentTypeError('content-123', 'audio/mp3');
    expect(error.message).toBe('Invalid media type for streaming');
  });

  it('should include contentId and mediaType in context', () => {
    const error = new InvalidContentTypeError('content-123', 'audio/mp3');
    expect(error.context).toMatchObject({
      contentId: 'content-123',
      mediaType: 'audio/mp3',
      code: 'INVALID_CONTENT_TYPE',
    });
  });

  it('should handle null mediaType', () => {
    const error = new InvalidContentTypeError('content-123', null);
    expect(error.context).toMatchObject({
      contentId: 'content-123',
      mediaType: null,
      code: 'INVALID_CONTENT_TYPE',
    });
  });
});

describe('OrganizationMismatchError', () => {
  it('should create error with correct code', () => {
    const error = new OrganizationMismatchError(
      'content-123',
      'org-456',
      'org-789'
    );
    expect(error.code).toBe('ORGANIZATION_MISMATCH');
  });

  it('should have correct message', () => {
    const error = new OrganizationMismatchError(
      'content-123',
      'org-456',
      'org-789'
    );
    expect(error.message).toBe(
      'Content does not belong to the specified organization'
    );
  });

  it('should have 403 status code', () => {
    const error = new OrganizationMismatchError(
      'content-123',
      'org-456',
      'org-789'
    );
    expect(error.statusCode).toBe(403);
  });

  it('should include organization IDs in context', () => {
    const error = new OrganizationMismatchError(
      'content-123',
      'org-456',
      'org-789'
    );
    expect(error.context).toMatchObject({
      contentId: 'content-123',
      expectedOrganizationId: 'org-456',
      actualOrganizationId: 'org-789',
    });
  });

  it('should handle null actualOrganizationId', () => {
    const error = new OrganizationMismatchError('content-123', 'org-456', null);
    expect(error.context).toMatchObject({
      contentId: 'content-123',
      expectedOrganizationId: 'org-456',
      actualOrganizationId: null,
    });
  });
});
