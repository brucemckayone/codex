/**
 * The settling refusal as the support page receives it (Codex-2hxff.70;
 * late-win data design §6). Every admin-api route is a procedure(), which
 * maps a thrown error with `mapErrorToResponse`, so this is the preview's and
 * the refund route's 422 envelope. (admin-api's own suites cannot reach it:
 * their SELF requests stop at the platform-owner gate, and the route shim
 * stands in for the mapper.)
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { ChargebackSettlingError, RefundedOutsideStripeError } from '../errors';

describe('ChargebackSettlingError', () => {
  // The design's message promised "an hour", which a refund Stripe won't
  // make outlasts; review cycle 1 (M3) reworded it to stay true.
  it('is a 422 whose details carry CHARGEBACK_SETTLING, and promises no time', () => {
    expect(
      mapErrorToResponse(new ChargebackSettlingError(), { logError: false })
    ).toEqual({
      statusCode: 422,
      response: {
        error: {
          code: 'BUSINESS_LOGIC_ERROR',
          message:
            "This payment's chargeback was decided for us, and the creators are still being paid back. Refunds wait until that finishes; a step that fails is retried every hour.",
          details: { code: 'CHARGEBACK_SETTLING' },
        },
      },
    });
  });
});

describe('RefundedOutsideStripeError', () => {
  // A charge support settled by hand (owner decision 2026-11-08, "Block it
  // in code"): its details carry the code and the date, nothing else.
  it('is a 422 whose details carry REFUNDED_OUTSIDE_STRIPE and when', () => {
    const at = new Date('2026-11-08T14:00:00.000Z');
    expect(
      mapErrorToResponse(new RefundedOutsideStripeError(at), {
        logError: false,
      })
    ).toEqual({
      statusCode: 422,
      response: {
        error: {
          code: 'BUSINESS_LOGIC_ERROR',
          message:
            "This payment was refunded outside Stripe, so it can't be refunded here.",
          details: {
            code: 'REFUNDED_OUTSIDE_STRIPE',
            refundedOutsideStripeAt: '2026-11-08T14:00:00.000Z',
          },
        },
      },
    });
  });
});
