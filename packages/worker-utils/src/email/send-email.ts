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
