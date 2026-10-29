/**
 * createKeyRefusal's STRIPE_UNAVAILABLE 503 keeps its details (Codex-adcgb).
 *
 * `mapErrorToResponse` withholds a 5xx's context unless the error opts in.
 * This 503's code lives only in `details.code` (the top-level code is
 * SERVICE_UNAVAILABLE), and the pages act on it: the tier dialog mints a new
 * submissionId, and the course builder says when to try again from
 * `retryAfter`. So the refusal opts in, and this pins that it still arrives.
 *
 * DB-free: `createKeyRefusal` is a pure function of the Stripe error.
 */

import { mapErrorToResponse } from '@codex/service-errors';
import { describe, expect, it } from 'vitest';
import { createKeyRefusal } from '../create-key-refusal';

const SUBJECT = {
  noun: 'course plan',
  reusedCode: 'COURSE_PLAN_KEY_REUSED',
  inProgressCode: 'COURSE_PLAN_IN_PROGRESS',
};

function stripeApiError(): Error {
  return Object.assign(new Error('An unknown error occurred'), {
    type: 'StripeAPIError',
  });
}

describe('createKeyRefusal: Stripe failing', () => {
  it('is a 503 whose code and retryAfter reach the client as details', () => {
    const keyedAt = Date.UTC(2026, 9, 29, 14, 20);
    const refusal = createKeyRefusal(
      stripeApiError(),
      SUBJECT,
      { courseId: 'course-1' },
      keyedAt
    );

    const { statusCode, response } = mapErrorToResponse(refusal, {
      logError: false,
    });

    expect(statusCode).toBe(503);
    expect(response.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.error.details).toEqual({
      courseId: 'course-1',
      code: 'STRIPE_UNAVAILABLE',
      retryAfter: '2026-10-29T15:00:00.000Z',
    });
  });

  // The tier dialog mints a new submissionId on exactly this code: without
  // it, every resubmit replays the failure Stripe stored under the old key
  // for 24 hours (monetisation +page.svelte, refuseCreate).
  it('reaches the tier dialog with its code and no retryAfter, as a tier key carries no hour', () => {
    const refusal = createKeyRefusal(
      stripeApiError(),
      {
        noun: 'tier',
        reusedCode: 'SUBMISSION_ID_REUSED',
        inProgressCode: 'SUBMISSION_IN_PROGRESS',
      },
      { organizationId: 'org-1', submissionId: 'sub-1' }
    );

    const { statusCode, response } = mapErrorToResponse(refusal, {
      logError: false,
    });

    expect(statusCode).toBe(503);
    expect(response.error.details).toEqual({
      organizationId: 'org-1',
      submissionId: 'sub-1',
      code: 'STRIPE_UNAVAILABLE',
    });
  });

  it('is no refusal at all for a Stripe error that is not an outage', () => {
    const invalid = Object.assign(new Error('No such price'), {
      type: 'StripeInvalidRequestError',
    });

    expect(createKeyRefusal(invalid, SUBJECT, { courseId: 'course-1' })).toBe(
      null
    );
  });
});
