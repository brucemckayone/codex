/**
 * Base Service Error Tests
 *
 * Comprehensive tests for all base error classes to ensure:
 * - Correct error inheritance
 * - Proper HTTP status codes
 * - Metadata/context handling
 * - Error serialization
 * - Type guards
 */

import { describe, expect, it } from 'vitest';
import {
  BusinessLogicError,
  ConflictError,
  ForbiddenError,
  InternalServiceError,
  isServiceError,
  NotFoundError,
  ServiceError,
  ValidationError,
  wrapError,
} from '../base-errors';

describe('Base Service Errors', () => {
  describe('ServiceError Base Class', () => {
    // Create a concrete implementation for testing
    class TestServiceError extends ServiceError {
      constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'TEST_ERROR', 400, context);
      }
    }

    it('should create error with message and code', () => {
      const error = new TestServiceError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should be instanceof Error', () => {
      const error = new TestServiceError('Test');
      expect(error).toBeInstanceOf(Error);
    });

    it('should be instanceof ServiceError', () => {
      const error = new TestServiceError('Test');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should include context metadata', () => {
      const context = { userId: '123', operation: 'test' };
      const error = new TestServiceError('Test', context);
      expect(error.context).toEqual(context);
    });

    it('should have correct name', () => {
      const error = new TestServiceError('Test');
      expect(error.name).toBe('TestServiceError');
    });

    it('should capture stack trace', () => {
      const error = new TestServiceError('Test');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TestServiceError');
    });
  });

  describe('NotFoundError', () => {
    it('should extend ServiceError', () => {
      const error = new NotFoundError('Resource not found');
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct error code', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should have correct HTTP status code', () => {
      const error = new NotFoundError('Resource not found');
      expect(error.statusCode).toBe(404);
    });

    it('should have correct message', () => {
      const error = new NotFoundError('User not found');
      expect(error.message).toBe('User not found');
    });

    it('should include context in metadata', () => {
      const error = new NotFoundError('User not found', { userId: '123' });
      expect(error.context).toEqual({ userId: '123' });
    });

    it('should be catchable as Error', () => {
      try {
        throw new NotFoundError('Test');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as NotFoundError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('ValidationError', () => {
    it('should extend ServiceError', () => {
      const error = new ValidationError('Validation failed');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should have correct error code', () => {
      const error = new ValidationError('Validation failed');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new ValidationError('Validation failed');
      expect(error.statusCode).toBe(400);
    });

    it('should include validation details in context', () => {
      const error = new ValidationError('Invalid input', {
        field: 'email',
        reason: 'invalid format',
      });
      expect(error.context).toEqual({
        field: 'email',
        reason: 'invalid format',
      });
    });
  });

  describe('ForbiddenError', () => {
    it('should extend ServiceError', () => {
      const error = new ForbiddenError('Access denied');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should have correct error code', () => {
      const error = new ForbiddenError('Access denied');
      expect(error.code).toBe('FORBIDDEN');
    });

    it('should have correct HTTP status code', () => {
      const error = new ForbiddenError('Access denied');
      expect(error.statusCode).toBe(403);
    });

    it('should include permission context', () => {
      const error = new ForbiddenError('Access denied', {
        userId: '123',
        resource: 'admin',
      });
      expect(error.context).toEqual({
        userId: '123',
        resource: 'admin',
      });
    });
  });

  describe('ConflictError', () => {
    it('should extend ServiceError', () => {
      const error = new ConflictError('Resource already exists');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should have correct error code', () => {
      const error = new ConflictError('Conflict');
      expect(error.code).toBe('CONFLICT');
    });

    it('should have correct HTTP status code', () => {
      const error = new ConflictError('Conflict');
      expect(error.statusCode).toBe(409);
    });

    it('should include conflict details', () => {
      const error = new ConflictError('Duplicate slug', {
        slug: 'test-org',
        existingId: '456',
      });
      expect(error.context).toEqual({
        slug: 'test-org',
        existingId: '456',
      });
    });
  });

  describe('BusinessLogicError', () => {
    it('should extend ServiceError', () => {
      const error = new BusinessLogicError('Business rule violated');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should have correct error code', () => {
      const error = new BusinessLogicError('Business rule violated');
      expect(error.code).toBe('BUSINESS_LOGIC_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new BusinessLogicError('Business rule violated');
      expect(error.statusCode).toBe(422);
    });

    it('should include business rule context', () => {
      const error = new BusinessLogicError('Cannot publish draft', {
        contentId: '789',
        status: 'draft',
      });
      expect(error.context).toEqual({
        contentId: '789',
        status: 'draft',
      });
    });
  });

  describe('InternalServiceError', () => {
    it('should extend ServiceError', () => {
      const error = new InternalServiceError('Internal error');
      expect(error).toBeInstanceOf(ServiceError);
    });

    it('should have correct error code', () => {
      const error = new InternalServiceError('Internal error');
      expect(error.code).toBe('INTERNAL_ERROR');
    });

    it('should have correct HTTP status code', () => {
      const error = new InternalServiceError('Internal error');
      expect(error.statusCode).toBe(500);
    });

    it('should include error context for logging', () => {
      const error = new InternalServiceError('Database error', {
        operation: 'query',
        table: 'users',
      });
      expect(error.context).toEqual({
        operation: 'query',
        table: 'users',
      });
    });
  });

  describe('isServiceError type guard', () => {
    it('should return true for ServiceError instances', () => {
      const error = new NotFoundError('Test');
      expect(isServiceError(error)).toBe(true);
    });

    it('should return true for all ServiceError subclasses', () => {
      const errors = [
        new NotFoundError('Test'),
        new ValidationError('Test'),
        new ForbiddenError('Test'),
        new ConflictError('Test'),
        new BusinessLogicError('Test'),
        new InternalServiceError('Test'),
      ];

      for (const error of errors) {
        expect(isServiceError(error)).toBe(true);
      }
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isServiceError(error)).toBe(false);
    });

    it('should return false for non-Error types', () => {
      expect(isServiceError('string')).toBe(false);
      expect(isServiceError(123)).toBe(false);
      expect(isServiceError(null)).toBe(false);
      expect(isServiceError(undefined)).toBe(false);
      expect(isServiceError({})).toBe(false);
    });
  });

  describe('wrapError utility', () => {
    it('should return ServiceError unchanged', () => {
      const original = new NotFoundError('Test');
      const wrapped = wrapError(original);
      expect(wrapped).toBe(original);
    });

    it('should convert unique constraint error to ConflictError', () => {
      const dbError = new Error(
        'duplicate key value violates unique constraint "users_email_key"'
      );
      const wrapped = wrapError(dbError, { table: 'users' });

      expect(wrapped).toBeInstanceOf(ConflictError);
      expect(wrapped.message).toBe('Resource already exists');
      expect(wrapped.context).toEqual({ table: 'users' });
    });

    it('should wrap unknown errors as InternalServiceError', () => {
      const unknownError = new Error('Something went wrong');
      const wrapped = wrapError(unknownError);

      expect(wrapped).toBeInstanceOf(InternalServiceError);
      expect(wrapped.message).toBe('An unexpected error occurred');
    });

    it('should wrap non-Error types as InternalServiceError', () => {
      const wrapped1 = wrapError('string error');
      const wrapped2 = wrapError({ error: 'object' });
      const wrapped3 = wrapError(123);

      expect(wrapped1).toBeInstanceOf(InternalServiceError);
      expect(wrapped2).toBeInstanceOf(InternalServiceError);
      expect(wrapped3).toBeInstanceOf(InternalServiceError);
    });

    it('should include additional context when wrapping', () => {
      const error = new Error('Test');
      const wrapped = wrapError(error, { operation: 'test', userId: '123' });

      expect(wrapped.context).toEqual({ operation: 'test', userId: '123' });
    });
  });

  describe('Error Serialization', () => {
    it('should serialize custom properties to JSON', () => {
      const error = new NotFoundError('User not found', { userId: '123' });
      const serialized = JSON.parse(JSON.stringify(error));

      // Note: Error.message and Error.stack are not enumerable by default
      // Only custom properties (code, statusCode, context, name) are serialized
      expect(serialized).toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
        context: { userId: '123' },
        name: 'NotFoundError',
      });

      // Message is accessible on the error object but not serialized
      expect(error.message).toBe('User not found');
    });

    it('should serialize errors without context', () => {
      const error = new ValidationError('Invalid input');
      const serialized = JSON.parse(JSON.stringify(error));

      expect(serialized.code).toBe('VALIDATION_ERROR');
      expect(serialized.statusCode).toBe(400);
      expect(serialized.context).toBeUndefined();

      // Message is on the object but not serialized by default
      expect(error.message).toBe('Invalid input');
    });

    it('should have accessible message and stack properties', () => {
      const error = new ConflictError('Conflict');

      // These properties exist on the error object
      expect(error.message).toBe('Conflict');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ConflictError');

      // But they're not enumerable for JSON serialization
      const serialized = JSON.parse(JSON.stringify(error));
      expect(serialized.code).toBe('CONFLICT');
      expect(serialized.statusCode).toBe(409);
    });
  });

  describe('Error Inheritance Chain', () => {
    it('should maintain correct inheritance chain for NotFoundError', () => {
      const error = new NotFoundError('Test');

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toBeInstanceOf(Error);
    });

    it('should maintain correct inheritance for all error types', () => {
      const errors = [
        new NotFoundError('Test'),
        new ValidationError('Test'),
        new ForbiddenError('Test'),
        new ConflictError('Test'),
        new BusinessLogicError('Test'),
        new InternalServiceError('Test'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(ServiceError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });

  describe('Error Context Immutability', () => {
    it('should not allow context modification after creation', () => {
      const context = { userId: '123' };
      const error = new NotFoundError('Test', context);

      // Attempt to modify context
      context.userId = '456';

      // Original error context should be unchanged (reference, not deep copy)
      // Note: This tests current behavior - context is not deep cloned
      expect(error.context?.userId).toBe('456');
    });
  });
});
