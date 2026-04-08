/**
 * Error Classification Tests
 *
 * Verifies that isTransientError correctly distinguishes between:
 * - Transient errors (return 500, Stripe retries)
 * - Permanent errors (return 200, acknowledged)
 */

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
