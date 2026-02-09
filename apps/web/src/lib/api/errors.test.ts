/**
 * API Error Tests
 *
 * Tests for the shared ApiError class used across client and server code.
 */

import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';

describe('ApiError', () => {
  describe('constructor', () => {
    it('creates an error with status and message', () => {
      const error = new ApiError(404, 'Not found');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.name).toBe('ApiError');
    });

    it('creates an error with optional code', () => {
      const error = new ApiError(400, 'Invalid input', 'VALIDATION_ERROR');

      expect(error.status).toBe(400);
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('creates an error without code', () => {
      const error = new ApiError(500, 'Internal error');

      expect(error.code).toBeUndefined();
    });
  });

  describe('isApiError', () => {
    it('returns true for ApiError instances', () => {
      const error = new ApiError(404, 'Not found');

      expect(ApiError.isApiError(error)).toBe(true);
    });

    it('returns false for regular Error instances', () => {
      const error = new Error('Regular error');

      expect(ApiError.isApiError(error)).toBe(false);
    });

    it('returns false for non-error objects', () => {
      expect(ApiError.isApiError({ status: 404, message: 'Not found' })).toBe(
        false
      );
      expect(ApiError.isApiError(null)).toBe(false);
      expect(ApiError.isApiError(undefined)).toBe(false);
      expect(ApiError.isApiError('error')).toBe(false);
    });

    it('narrows type correctly', () => {
      const maybeError: unknown = new ApiError(403, 'Forbidden');

      if (ApiError.isApiError(maybeError)) {
        // TypeScript should recognize these properties
        expect(maybeError.status).toBe(403);
        expect(maybeError.message).toBe('Forbidden');
      }
    });
  });
});
