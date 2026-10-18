/**
 * Error Classification Tests
 *
 * Verifies that isTransientError correctly distinguishes between:
 * - Transient errors (return 500, Stripe retries)
 * - Permanent errors (return 200, acknowledged)
 */

import {
  ConflictError,
  InternalServiceError,
  mapErrorToResponse,
  NotFoundError,
  wrapError,
} from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { isTransientError } from '../error-classification';

/** Helper to create a Stripe-shaped error */
function createStripeError(type: string, statusCode?: number): Error {
  const err = new Error(`Stripe error: ${type}`);
  (err as unknown as Record<string, unknown>).type = type;
  if (statusCode !== undefined) {
    (err as unknown as Record<string, unknown>).statusCode = statusCode;
  }
  return err;
}

describe('isTransientError', () => {
  // ─── Transient errors (should return true) ──────────────────────────────────

  describe('database connection errors', () => {
    it('should return true for connection refused', () => {
      expect(isTransientError(new Error('ECONNREFUSED'))).toBe(true);
    });

    it('should return true for connection reset', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should return true for connection timeout', () => {
      expect(
        isTransientError(new Error('connection timeout after 5000ms'))
      ).toBe(true);
    });

    it('should return true for generic timeout', () => {
      expect(isTransientError(new Error('timeout'))).toBe(true);
    });

    it('should return true for socket hang up', () => {
      expect(isTransientError(new Error('socket hang up'))).toBe(true);
    });

    it('should return true for fetch failed', () => {
      expect(isTransientError(new Error('fetch failed'))).toBe(true);
    });
  });

  describe('Stripe server errors', () => {
    it('should return true for Stripe API 500 error', () => {
      expect(isTransientError(createStripeError('StripeAPIError', 500))).toBe(
        true
      );
    });

    it('should return true for Stripe API 502 error', () => {
      expect(isTransientError(createStripeError('StripeAPIError', 502))).toBe(
        true
      );
    });

    it('should return true for Stripe API 503 error', () => {
      expect(isTransientError(createStripeError('StripeAPIError', 503))).toBe(
        true
      );
    });

    it('should return true for Stripe connection error', () => {
      expect(isTransientError(createStripeError('StripeConnectionError'))).toBe(
        true
      );
    });

    it('should return true for Stripe rate limit error', () => {
      expect(isTransientError(createStripeError('StripeRateLimitError'))).toBe(
        true
      );
    });
  });

  describe('network errors', () => {
    it('should return true for ENOTFOUND', () => {
      expect(isTransientError(new Error('getaddrinfo ENOTFOUND'))).toBe(true);
    });

    it('should return true for ETIMEDOUT', () => {
      expect(isTransientError(new Error('connect ETIMEDOUT'))).toBe(true);
    });
  });

  // ─── Permanent errors (should return false) ─────────────────────────────────

  describe('Stripe client errors', () => {
    it('should return false for Stripe API 400 error', () => {
      expect(isTransientError(createStripeError('StripeAPIError', 400))).toBe(
        false
      );
    });

    it('should return false for Stripe API 404 error', () => {
      expect(isTransientError(createStripeError('StripeAPIError', 404))).toBe(
        false
      );
    });

    it('should return false for Stripe invalid request error', () => {
      expect(
        isTransientError(createStripeError('StripeInvalidRequestError', 400))
      ).toBe(false);
    });

    it('should return false for Stripe card error', () => {
      expect(isTransientError(createStripeError('StripeCardError', 402))).toBe(
        false
      );
    });

    it('should return false for Stripe authentication error', () => {
      expect(
        isTransientError(createStripeError('StripeAuthenticationError', 401))
      ).toBe(false);
    });
  });

  describe('business logic errors', () => {
    it('should return false for generic Error', () => {
      expect(isTransientError(new Error('Something went wrong'))).toBe(false);
    });

    it('should return false for non-Error values', () => {
      expect(isTransientError('string error')).toBe(false);
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
      expect(isTransientError(42)).toBe(false);
    });
  });

  describe('ServiceError subclasses', () => {
    it('should return false for ServiceError instances', () => {
      // Simulate ServiceError — we can't import from @codex/service-errors
      // in the worker test environment, but the real isTransientError does
      // `instanceof ServiceError`. For this test, verify the pattern:
      const { ServiceError } = require('@codex/service-errors');
      const err = new ServiceError('Not found', 404);
      expect(isTransientError(err)).toBe(false);
    });
  });

  // Codex-2hxff.6: a service wraps every unknown error (handleError →
  // wrapError) and keeps the original on `cause`. The wrap must not hide an
  // outage from the classifier, and must not make a bug look transient.
  describe('errors wrapped by a service', () => {
    it('a wrapped connection error is transient', () => {
      expect(
        isTransientError(wrapError(new Error('Connection terminated')))
      ).toBe(true);
    });

    it('a wrapped bug stays permanent', () => {
      expect(isTransientError(wrapError(new TypeError('x is undefined')))).toBe(
        false
      );
    });

    it('a ServiceError thrown on purpose (no cause) stays permanent', () => {
      expect(isTransientError(new NotFoundError('Purchase not found'))).toBe(
        false
      );
    });

    it('a wrapped unique violation (a replay) stays permanent', () => {
      const replay = wrapError(
        Object.assign(
          new Error('duplicate key value violates unique constraint "x"'),
          { code: '23505' }
        )
      );
      expect(replay).toBeInstanceOf(ConflictError);
      expect(isTransientError(replay)).toBe(false);
    });

    it('the original is never part of the API response', () => {
      const wrapped = wrapError(new Error('password=hunter2 connection lost'));
      expect(
        JSON.stringify(mapErrorToResponse(wrapped).response)
      ).not.toContain('hunter2');
    });

    it('a cause chain that loops ends permanent instead of recursing forever', () => {
      const a = new InternalServiceError('a');
      const b = new InternalServiceError('b', undefined, { cause: a });
      Object.defineProperty(a, 'cause', { value: b });
      expect(isTransientError(a)).toBe(false);
    });
  });

  describe('Postgres SQLSTATE codes', () => {
    const pg = (code: string) =>
      Object.assign(new Error('database error'), { code });

    it.each([
      ['08006', 'connection failure'],
      ['08001', 'unable to connect'],
      ['40001', 'serialization failure'],
      ['40P01', 'deadlock'],
      ['53300', 'too many connections'],
      ['57P01', 'admin shutdown'],
      ['57P03', 'cannot connect now'],
      ['57014', 'statement timeout'],
    ])('%s (%s) is transient', (code) => {
      expect(isTransientError(pg(code))).toBe(true);
    });

    it.each([
      ['23505', 'unique violation'],
      ['23503', 'foreign key violation'],
      ['22P02', 'invalid text representation'],
      ['42703', 'undefined column'],
    ])('%s (%s) is permanent', (code) => {
      expect(isTransientError(pg(code))).toBe(false);
    });
  });

  describe('socket errors under a driver error', () => {
    it("fetch's `cause.code = 'ECONNRESET'` is transient", () => {
      const fetchFailed = new Error('request to the database was refused', {
        cause: Object.assign(new Error('other side closed'), {
          code: 'ECONNRESET',
        }),
      });
      expect(isTransientError(fetchFailed)).toBe(true);
    });

    it("Neon's `sourceError` is followed", () => {
      const neon = Object.assign(new Error('Error querying the database'), {
        sourceError: Object.assign(new Error('read'), { code: 'EPIPE' }),
      });
      expect(isTransientError(neon)).toBe(true);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should be case-insensitive for message matching', () => {
      expect(isTransientError(new Error('CONNECTION RESET'))).toBe(true);
      expect(isTransientError(new Error('Timeout exceeded'))).toBe(true);
    });

    it('should return false for StripeAPIError without statusCode', () => {
      expect(isTransientError(createStripeError('StripeAPIError'))).toBe(false);
    });

    it('should handle error-like objects gracefully', () => {
      const errorLike = { message: 'timeout', type: 'SomeError' };
      expect(isTransientError(errorLike)).toBe(false);
    });
  });
});
