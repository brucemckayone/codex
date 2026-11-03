/**
 * A subscription carrying a Stripe subscription schedule that is not ours
 * (one made in the Stripe Dashboard, for example) can't be changed here
 * (Codex-2hxff.97, data design §3.4): the worker refuses a plan change, its
 * preview, cancel, reactivate and Keep with SUBSCRIPTION_SCHEDULED_ELSEWHERE,
 * writes nothing, and alerts support with an `errorId`. A retry can't help,
 * so the member is told to contact support and given the id to quote. Fixed
 * copy, never the worker's message.
 */

import * as m from '$paraglide/messages';

export const SCHEDULED_ELSEWHERE = 'SUBSCRIPTION_SCHEDULED_ELSEWHERE';

/** The line for that refusal, or null for any other failure. */
export function scheduledElsewhereLine(failure: {
  detailsCode?: string;
  errorId?: string;
}): string | null {
  if (failure.detailsCode !== SCHEDULED_ELSEWHERE) return null;
  return failure.errorId
    ? m.subscription_refusal_scheduled_elsewhere({ errorId: failure.errorId })
    : m.subscription_refusal_scheduled_elsewhere_no_ref();
}
