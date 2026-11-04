/**
 * The refusal of a subscription whose Stripe schedule isn't ours
 * (Codex-2hxff.97): fixed words with the id support was alerted with, never
 * the worker's message, and nothing for any other failure.
 */

import { describe, expect, it } from 'vitest';
import * as m from '$paraglide/messages';
import { scheduledElsewhereLine } from './scheduled-elsewhere';

describe('scheduledElsewhereLine', () => {
  it('gives the member the id to quote', () => {
    const line = scheduledElsewhereLine({
      detailsCode: 'SUBSCRIPTION_SCHEDULED_ELSEWHERE',
      errorId: 'err_7f3a',
    });
    expect(line).toBe(
      m.subscription_refusal_scheduled_elsewhere({ errorId: 'err_7f3a' })
    );
    expect(line).toContain('err_7f3a');
  });

  it('still says to contact support without an id', () => {
    expect(
      scheduledElsewhereLine({
        detailsCode: 'SUBSCRIPTION_SCHEDULED_ELSEWHERE',
      })
    ).toBe(m.subscription_refusal_scheduled_elsewhere_no_ref());
  });

  it('is null for every other failure, even one with an id', () => {
    expect(
      scheduledElsewhereLine({
        detailsCode: 'SUBSCRIPTION_DISPUTED',
        errorId: 'x',
      })
    ).toBeNull();
    expect(scheduledElsewhereLine({})).toBeNull();
  });
});
