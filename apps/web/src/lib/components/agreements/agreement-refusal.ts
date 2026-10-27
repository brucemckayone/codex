/**
 * What a refused propose, counter or accept says.
 *
 * A recipient who can't hold an agreement is a 422 whose `reason`
 * (`RecipientCannotHoldAgreementError`, Codex-2hxff.76/.77) is forwarded by
 * `forwardClientErrors` to the error body, and gets plain copy here. Anything
 * else shows the forwarded message.
 *
 * A remote command rejects with kit's `HttpError`, which is NOT an `Error`:
 * its text is at `body.message`. `err instanceof Error ? err.message : …`
 * therefore always fell through to the fallback.
 */

import { queryErrorMessage } from '$lib/remote/query-result';
import * as m from '$paraglide/messages';

export function agreementErrorMessage(err: unknown, fallback: string): string {
  const body = (err as { body?: { reason?: unknown } } | null | undefined)
    ?.body;
  switch (body?.reason) {
    case 'owner':
      return m.agreement_refused_owner();
    case 'subscriber':
      return m.agreement_refused_subscriber();
    case 'no_creator_account':
      return m.agreement_refused_no_creator_account();
    default:
      return queryErrorMessage(err, fallback) ?? fallback;
  }
}
