/**
 * Worker-to-Worker Email Sending Helper
 *
 * Wraps the fire-and-forget pattern for sending emails via notifications-api.
 * All workers should use this instead of directly constructing email provider calls.
 *
 * Usage:
 *   sendEmailToWorker(env, executionCtx, {
 *     to: user.email,
 *     templateName: 'purchase-receipt',
 *     data: { userName: user.name, ... },
 *     category: 'transactional',
 *   });
 */

import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
import { buildServiceUrl as getServiceUrl } from '@codex/urls';
import type { InternalSendEmailInput } from '@codex/validation';

export type SendEmailToWorkerParams = Omit<InternalSendEmailInput, 'data'> & {
  data: Record<string, string | number | boolean>;
};

/**
 * Send an email via the notifications-api internal endpoint.
 *
 * Wraps the call in executionCtx.waitUntil() so the email never blocks
 * the HTTP response to the user. Errors are caught and suppressed --
 * email failures must never break the calling worker's response.
 */
export function sendEmailToWorker(
  env: Bindings,
  executionCtx: ExecutionContext,
  params: SendEmailToWorkerParams
): void {
  const url = `${getServiceUrl('notifications', env)}/internal/send`;
  const body = JSON.stringify(params);

  // Correlate by userId, NEVER the recipient address: console.* bypasses the
  // ObservabilityClient redaction pipeline, and `to` is PII.
  const correlation = {
    templateName: params.templateName,
    ...(params.userId ? { userId: params.userId } : {}),
  };
  executionCtx.waitUntil(
    workerFetch(url, { method: 'POST', body }, env.WORKER_SHARED_SECRET)
      .then((response) => {
        // A refusal is an answer, not a throw: a missing template (404),
        // data failing the template's schema (422) or a bad signature (401)
        // was otherwise lost on both sides (notifications-api does not log
        // the ServiceErrors it maps).
        if (!response.ok) {
          console.error('[sendEmailToWorker] refused', {
            ...correlation,
            status: response.status,
          });
        }
      })
      .catch((err: unknown) => {
        // Log transport failures so CF Workers logs capture them. Email
        // failures must not break the calling worker — behaviour unchanged.
        console.error('[sendEmailToWorker] transport failed', {
          ...correlation,
          error: err instanceof Error ? err.message : String(err),
        });
      })
  );
}

/**
 * What notifications-api made of an awaited send. `accepted` means it answered
 * 2xx AND its body says `success: true`: the provider took the email. A 2xx
 * can also be a skip (`{ success: false, skipped: 'opted_out' }` for an
 * opted-out non-transactional email), which is not accepted (review A,
 * silent #9).
 */
export type EmailSendResult =
  | { accepted: true }
  /** notifications-api answered non-2xx: 4xx refused it, 5xx may have sent it. */
  | { accepted: false; status: number }
  /** It answered 2xx without sending; `skipped` says why. */
  | { accepted: false; skipped: string }
  /**
   * No usable answer: a transport failure, no answer within the timeout, or a
   * 2xx whose body is not a send result. The email MAY have gone out.
   */
  | { accepted: false; error: string };

/**
 * 5 s, so a price fan-out's last batch still finishes inside the runtime's
 * 30 s `waitUntil` budget: it starts by 20 s (`PRICE_FAN_OUT_BUDGET_MS` in
 * `@codex/subscription`), then needs its Stripe read (~1 s), this send (at
 * most 5 s) and its Stripe write (~1 s): 20 + 1 + 5 + 1 = ~27 s < 30 s.
 *
 * notifications-api's worst case is longer (three provider attempts with 1 s
 * and 2 s backoff), so a send still running at 5 s is not accepted: the
 * caller treats its outcome as unknown and holds the move back.
 */
const AWAITED_SEND_TIMEOUT_MS = 5_000;

/**
 * Send an email and wait for notifications-api's answer, for a caller whose
 * next step depends on the email going out: a price change moves only after
 * its 30-day notice is accepted (owner decision D-P3, Codex-2hxff.43).
 *
 * Unlike `sendEmailToWorker` it needs no `ExecutionContext`, never throws and
 * logs nothing: the caller owns the outcome, and reports a refusal through its
 * own ObservabilityClient. A send that outlasts the timeout counts as not
 * accepted, so the caller holds back rather than act on a notice that may not
 * have gone.
 */
export async function sendEmailToWorkerAwaited(
  env: Bindings,
  params: SendEmailToWorkerParams,
  options: { timeoutMs?: number } = {}
): Promise<EmailSendResult> {
  const url = `${getServiceUrl('notifications', env)}/internal/send`;
  try {
    const response = await workerFetch(
      url,
      {
        method: 'POST',
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(
          options.timeoutMs ?? AWAITED_SEND_TIMEOUT_MS
        ),
      },
      env.WORKER_SHARED_SECRET
    );
    if (!response.ok) return { accepted: false, status: response.status };
    // `procedure()` wraps the route's `{ success, messageId, skipped }` in
    // `{ data }`.
    const body = (await response.json().catch(() => null)) as {
      data?: { success?: unknown; skipped?: unknown };
    } | null;
    if (body?.data?.success === true) return { accepted: true };
    if (typeof body?.data?.skipped === 'string') {
      return { accepted: false, skipped: body.data.skipped };
    }
    return { accepted: false, error: '2xx without a send result' };
  } catch (err: unknown) {
    return {
      accepted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
