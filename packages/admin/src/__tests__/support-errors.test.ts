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
import { ChargebackSettlingError } from '../errors';

describe('ChargebackSettlingError', () => {
  it("is a 422 whose details carry CHARGEBACK_SETTLING, with the design's message word for word", () => {
    expect(
      mapErrorToResponse(new ChargebackSettlingError(), { logError: false })
    ).toEqual({
      statusCode: 422,
      response: {
        error: {
          code: 'BUSINESS_LOGIC_ERROR',
          message:
            "This payment's chargeback was just decided for us, and the creators are being paid back. Try the refund again in an hour.",
          details: { code: 'CHARGEBACK_SETTLING' },
        },
      },
    });
  });
});
