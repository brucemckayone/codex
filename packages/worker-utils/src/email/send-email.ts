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

import { getServiceUrl } from '@codex/constants';
import { workerFetch } from '@codex/security';
import type { Bindings } from '@codex/shared-types';
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

  executionCtx.waitUntil(
    workerFetch(url, { method: 'POST', body }, env.WORKER_SHARED_SECRET).catch(
      () => {
        // Silently swallow -- email failures must not break calling worker.
        // The notifications-api audit log captures failures on its side.
      }
    )
  );
}
