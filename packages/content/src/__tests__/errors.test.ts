/**
 * Content Service Error Tests
 *
 * Comprehensive tests for content-specific error classes
 */

import {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import {
  ContentAlreadyPublishedError,
  ContentNotFoundError,
  ContentTypeMismatchError,
  MediaNotFoundError,
  MediaNotReadyError,
  MediaOwnershipError,
  SlugConflictError,
} from '../errors';

describe('Content Service Errors', () => {
  describe('ContentNotFoundError', () => {
    it('should extend NotFoundError', () => {
      const error = new ContentNotFoundError('content-123');
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new ContentNotFoundError('content-123');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should have correct HTTP status code', () => {
      const error = new ContentNotFoundError('content-123');
      expect(error.statusCode).toBe(404);
    });

    it('should have correct message', () => {
      const error = new ContentNotFoundError('content-123');
      expect(error.message).toBe('Content not found');
    });

    it('should include contentId in context', () => {
      const error = new ContentNotFoundError('content-123');
      expect(error.context).toEqual({ contentId: 'content-123' });
    });

    it('should be catchable as Error', () => {
      try {
        throw new ContentNotFoundError('content-123');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as ContentNotFoundError).context?.contentId).toBe(
          'content-123'
        );
      }
    });

    it('should serialize custom properties to JSON', () => {
      const error = new ContentNotFoundError('content-123');
      const serialized = JSON.parse(JSON.stringify(error));

      // Only custom properties are serialized
      expect(serialized).toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
        context: { contentId: 'content-123' },
      });

      // Message is accessible but not serialized
      expect(error.message).toBe('Content not found');
    });
  });

  describe('MediaNotFoundError', () => {
    it('should extend NotFoundError', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should have correct HTTP status code', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error.statusCode).toBe(404);
    });

    it('should have correct message', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error.message).toBe('Media item not found');
    });

    it('should include mediaItemId in context', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error.context).toEqual({ mediaItemId: 'media-123' });
    });

    it('should maintain correct inheritance chain', () => {
      const error = new MediaNotFoundError('media-123');
      expect(error).toBeInstanceOf(MediaNotFoundError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('MediaNotReadyError', () => {
    it('should extend BusinessLogicError', () => {
      const error = new MediaNotReadyError('media-123');
      expect(error).toBeInstanceOf(BusinessLogicError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new MediaNotReadyError('media-123');
      expect(error.code).toBe('BUSINESS_LOGIC_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new MediaNotReadyError('media-123');
      expect(error.statusCode).toBe(422);
    });

    it('should have descriptive message', () => {
      const error = new MediaNotReadyError('media-123');
      expect(error.message).toBe('Media item not ready for publishing');
    });

    it('should include mediaItemId in context', () => {
      const error = new MediaNotReadyError('media-123');
      expect(error.context).toEqual({ mediaItemId: 'media-123' });
    });

    it('should be catchable as BusinessLogicError', () => {
      try {
        throw new MediaNotReadyError('media-123');
      } catch (e) {
        expect(e).toBeInstanceOf(BusinessLogicError);
        expect((e as MediaNotReadyError).context?.mediaItemId).toBe(
          'media-123'
        );
      }
    });

    it('should serialize custom properties correctly', () => {
      const error = new MediaNotReadyError('media-123');
      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized).toMatchObject({
        code: 'BUSINESS_LOGIC_ERROR',
        statusCode: 422,
        context: { mediaItemId: 'media-123' },
      });

      expect(error.message).toBe('Media item not ready for publishing');
    });
  });

  describe('ContentTypeMismatchError', () => {
    it('should extend BusinessLogicError', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      expect(error).toBeInstanceOf(BusinessLogicError);
    });

    it('should have correct error code', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      expect(error.code).toBe('BUSINESS_LOGIC_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      expect(error.statusCode).toBe(422);
    });

    it('should have descriptive message', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      expect(error.message).toBe('Content type does not match media type');
    });

    it('should include type information in context', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      expect(error.context).toEqual({
        expectedType: 'video',
        actualType: 'audio',
      });
    });

    it('should handle different type mismatches', () => {
      const error1 = new ContentTypeMismatchError('audio', 'video');
      const error2 = new ContentTypeMismatchError('video', 'written');

      expect(error1.context).toEqual({
        expectedType: 'audio',
        actualType: 'video',
      });
      expect(error2.context).toEqual({
        expectedType: 'video',
        actualType: 'written',
      });
    });

    it('should serialize correctly', () => {
      const error = new ContentTypeMismatchError('video', 'audio');
      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized.context).toEqual({
        expectedType: 'video',
        actualType: 'audio',
      });
    });
  });

  describe('SlugConflictError', () => {
    it('should extend ConflictError', () => {
      const error = new SlugConflictError('test-slug');
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new SlugConflictError('test-slug');
      expect(error.code).toBe('CONFLICT');
    });

    it('should have correct HTTP status code', () => {
      const error = new SlugConflictError('test-slug');
      expect(error.statusCode).toBe(409);
    });

    it('should have descriptive message', () => {
      const error = new SlugConflictError('test-slug');
      expect(error.message).toBe('Content with this slug already exists');
    });

    it('should include slug in context', () => {
      const error = new SlugConflictError('test-slug');
      expect(error.context).toEqual({ slug: 'test-slug' });
    });

    it('should maintain correct inheritance chain', () => {
      const error = new SlugConflictError('test-slug');
      expect(error).toBeInstanceOf(SlugConflictError);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should handle various slug formats', () => {
      const error1 = new SlugConflictError('simple-slug');
      const error2 = new SlugConflictError('complex-slug-with-numbers-123');

      expect(error1.context?.slug).toBe('simple-slug');
      expect(error2.context?.slug).toBe('complex-slug-with-numbers-123');
    });
  });

  describe('ContentAlreadyPublishedError', () => {
    it('should extend BusinessLogicError', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      expect(error).toBeInstanceOf(BusinessLogicError);
    });

    it('should have correct error code', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      expect(error.code).toBe('BUSINESS_LOGIC_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      expect(error.statusCode).toBe(422);
    });

    it('should have descriptive message', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      expect(error.message).toBe('Content is already published');
    });

    it('should include contentId in context', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      expect(error.context).toEqual({ contentId: 'content-123' });
    });

    it('should serialize custom properties correctly', () => {
      const error = new ContentAlreadyPublishedError('content-123');
      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized).toMatchObject({
        code: 'BUSINESS_LOGIC_ERROR',
        statusCode: 422,
        context: { contentId: 'content-123' },
      });

      expect(error.message).toBe('Content is already published');
    });
  });

  describe('MediaOwnershipError', () => {
    it('should extend ForbiddenError', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should have correct HTTP status code', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error.statusCode).toBe(403);
    });

    it('should have descriptive message', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error.message).toBe('User does not own this media item');
    });

    it('should include mediaItemId and userId in context', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error.context).toEqual({
        mediaItemId: 'media-123',
        userId: 'user-456',
      });
    });

    it('should maintain correct inheritance chain', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      expect(error).toBeInstanceOf(MediaOwnershipError);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should be catchable as ForbiddenError', () => {
      try {
        throw new MediaOwnershipError('media-123', 'user-456');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenError);
        const ownershipError = e as MediaOwnershipError;
        expect(ownershipError.context?.mediaItemId).toBe('media-123');
        expect(ownershipError.context?.userId).toBe('user-456');
      }
    });

    it('should serialize custom properties correctly', () => {
      const error = new MediaOwnershipError('media-123', 'user-456');
      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized).toMatchObject({
        code: 'FORBIDDEN',
        statusCode: 403,
        context: {
          mediaItemId: 'media-123',
          userId: 'user-456',
        },
      });

      expect(error.message).toBe('User does not own this media item');
    });
  });

  describe('Error Name Properties', () => {
    it('should have correct name for each error type', () => {
      expect(new ContentNotFoundError('1').name).toBe('ContentNotFoundError');
      expect(new MediaNotFoundError('1').name).toBe('MediaNotFoundError');
      expect(new MediaNotReadyError('1').name).toBe('MediaNotReadyError');
      expect(new ContentTypeMismatchError('a', 'b').name).toBe(
        'ContentTypeMismatchError'
      );
      expect(new SlugConflictError('1').name).toBe('SlugConflictError');
      expect(new ContentAlreadyPublishedError('1').name).toBe(
        'ContentAlreadyPublishedError'
      );
      expect(new MediaOwnershipError('1', '2').name).toBe(
        'MediaOwnershipError'
      );
    });
  });

  describe('Error Stack Traces', () => {
    it('should capture stack traces for all error types', () => {
      const errors = [
        new ContentNotFoundError('1'),
        new MediaNotFoundError('1'),
        new MediaNotReadyError('1'),
        new ContentTypeMismatchError('a', 'b'),
        new SlugConflictError('1'),
        new ContentAlreadyPublishedError('1'),
        new MediaOwnershipError('1', '2'),
      ];

      for (const error of errors) {
        expect(error.stack).toBeDefined();
        expect(error.stack).toContain(error.name);
      }
    });
  });
});
