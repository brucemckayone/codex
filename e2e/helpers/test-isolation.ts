/**
 * Test isolation utilities for parallel E2E test execution
 *
 * These helpers ensure each test file creates unique identifiers
 * that won't collide with parallel test runs.
 */

import { randomUUID } from 'node:crypto';

/**
 * Create a short unique prefix for test data.
 * Uses UUID slice for guaranteed uniqueness across parallel runs.
 *
 * Format: "t_<8-char-uuid>_" (e.g., "t_a1b2c3d4_")
 */
export function createTestPrefix(): string {
  return `t_${randomUUID().slice(0, 8)}_`;
}

/**
 * Context object providing scoped test data generators.
 * Each function prefixes the base value with the unique test prefix.
 */
export interface ScopedTestContext {
  /** The unique prefix for this test context */
  prefix: string;

  /**
   * Generate a unique email address
   * @param base - Base identifier (e.g., "buyer", "creator")
   * @returns Email like "t_a1b2c3d4_buyer@example.com"
   */
  email: (base: string) => string;

  /**
   * Generate a unique slug
   * @param base - Base identifier (e.g., "org", "content")
   * @returns Slug like "t_a1b2c3d4_org"
   */
  slug: (base: string) => string;

  /**
   * Generate a unique identifier
   * @param base - Base identifier
   * @returns ID like "t_a1b2c3d4_media-1"
   */
  id: (base: string) => string;

  /**
   * Generate a unique name
   * @param base - Base name (e.g., "Test Org")
   * @returns Name like "t_a1b2c3d4 Test Org"
   */
  name: (base: string) => string;
}

/**
 * Create a scoped test context with unique generators.
 *
 * Usage:
 * ```typescript
 * const ctx = createScopedTestContext();
 * const email = ctx.email('buyer'); // "t_a1b2c3d4_buyer@example.com"
 * const slug = ctx.slug('org');     // "t_a1b2c3d4_org"
 * ```
 *
 * All data created with the same context instance shares the same prefix,
 * making it easy to identify and group related test data.
 */
export function createScopedTestContext(): ScopedTestContext {
  const prefix = createTestPrefix();

  return {
    prefix,
    email: (base: string) => `${prefix}${base}@example.com`,
    slug: (base: string) => `${prefix}${base}`,
    id: (base: string) => `${prefix}${base}`,
    name: (base: string) => `${prefix.slice(0, -1)} ${base}`,
  };
}

/**
 * Generate a unique payment intent ID for Stripe webhook tests.
 * @param base - Optional base identifier
 * @returns Payment intent ID like "pi_test_a1b2c3d4e5f6"
 */
export function createPaymentIntentId(base?: string): string {
  const suffix = randomUUID().slice(0, 12).replace(/-/g, '');
  return base ? `pi_${base}_${suffix}` : `pi_test_${suffix}`;
}

/**
 * Generate a unique Stripe session ID for checkout tests.
 * @param base - Optional base identifier
 * @returns Session ID like "cs_test_a1b2c3d4e5f6"
 */
export function createStripeSessionId(base?: string): string {
  const suffix = randomUUID().slice(0, 12).replace(/-/g, '');
  return base ? `cs_${base}_${suffix}` : `cs_test_${suffix}`;
}
