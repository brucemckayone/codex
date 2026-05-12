/**
 * Admin route — query-schema coercion tests.
 *
 * The reconcile endpoint receives `dryRun` as a query-string value (always
 * a string at the wire). The schema must:
 *   - default to dryRun=true when omitted (safe default — operator must
 *     opt-in to write mode)
 *   - accept 'true' / 'false' string literals and coerce to booleans
 *   - reject anything else, so a typo'd `dryRun=yes` doesn't silently
 *     evaluate to truthy and skip writes
 *
 * The handler itself is a thin pass-through to
 * SubscriptionService.reconcileFromStripe — covered exhaustively by the
 * subscription package's unit tests. We only own the wire-coercion contract
 * here.
 */

import { describe, expect, it } from 'vitest';
import { reconcileQuerySchema } from '../admin';

describe('admin /subscriptions/reconcile query schema', () => {
  it('defaults dryRun to true when omitted (safe-by-default)', () => {
    const result = reconcileQuerySchema.parse({});
    expect(result.dryRun).toBe(true);
  });

  it('coerces dryRun=true to boolean true', () => {
    const result = reconcileQuerySchema.parse({ dryRun: 'true' });
    expect(result.dryRun).toBe(true);
  });

  it('coerces dryRun=false to boolean false', () => {
    const result = reconcileQuerySchema.parse({ dryRun: 'false' });
    expect(result.dryRun).toBe(false);
  });

  it('rejects ambiguous truthy strings (yes / 1 / on)', () => {
    // If we silently coerced these the operator could believe they're in
    // apply mode when they're actually in dry-run, or vice versa. Reject
    // so the typo is immediately visible.
    expect(() => reconcileQuerySchema.parse({ dryRun: 'yes' })).toThrow();
    expect(() => reconcileQuerySchema.parse({ dryRun: '1' })).toThrow();
    expect(() => reconcileQuerySchema.parse({ dryRun: 'on' })).toThrow();
  });

  it('rejects boolean true/false (we only accept string literals)', () => {
    // Query params arrive as strings. Receiving a raw boolean here would
    // indicate a client constructing the request wrong — fail loudly.
    expect(() => reconcileQuerySchema.parse({ dryRun: true })).toThrow();
    expect(() => reconcileQuerySchema.parse({ dryRun: false })).toThrow();
  });
});
