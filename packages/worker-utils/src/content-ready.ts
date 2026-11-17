/**
 * Publish when ready (Codex-a6ofh.2.8), media-api's side: tells content-api
 * that a media item changed, with worker HMAC, so the drafts scheduled to
 * publish when it is ready settle by its state there.
 */

import type { WaitUntilFn } from '@codex/cache';
import { messageForLog } from '@codex/database';
import type { ObservabilityClient } from '@codex/observability';
import { workerFetch } from '@codex/security';
import { InternalServiceError } from '@codex/service-errors';
import type { ContentReadyNotifier } from '@codex/transcoding';
import { buildServiceUrl } from '@codex/urls';

/** content-api's route for it: its mount and this caller share the path. */
export const CONTENT_MEDIA_READY_ROUTE = '/internal/content/media-ready';

/**
 * content-api's base URL, by the environment NAME alone: content's override
 * key is `API_URL`, which media-api sets to its OWN URL (RunPod's callbacks),
 * so passing the bindings would send the call back to media-api.
 *
 * Not proof against it: `buildServiceUrl` also reads `process.env`, which
 * Workers fills from the bindings at a compatibility date of 2025-04-01 or
 * later with `nodejs_compat`. media-api is on 2025-01-01; bumping it means
 * renaming content's override key first (Codex-3hoxm).
 */
export function contentApiUrlFor(env: { ENVIRONMENT?: string }): string {
  return buildServiceUrl('content', { ENVIRONMENT: env.ENVIRONMENT });
}

/**
 * A refusal no retry cures: a secret, route or contract fault that switches
 * publish when ready off for everyone, not a blip. 408 and 429 are blips.
 */
const refusesForGood = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

export class WorkerContentReadyNotifier implements ContentReadyNotifier {
  constructor(
    private readonly contentApiUrl: string,
    private readonly workerSecret: string,
    private readonly waitUntil: WaitUntilFn,
    private readonly obs?: ObservabilityClient
  ) {}

  mediaChanged(mediaItemId: string): void {
    this.waitUntil(
      this.settle(mediaItemId).catch((error: unknown) => {
        // Not lost: the maintenance run settles any item left this way.
        this.obs?.warn('Publish-when-ready call to content-api failed', {
          mediaId: mediaItemId,
          error: messageForLog(error),
        });
      })
    );
  }

  /**
   * Hands the item to content-api, which answers at once (204) and settles
   * after; what it did is logged there. Throws on any other answer, at error
   * first for a refusal no retry cures.
   */
  async settle(mediaItemId: string): Promise<void> {
    const response = await workerFetch(
      `${this.contentApiUrl}${CONTENT_MEDIA_READY_ROUTE}`,
      {
        method: 'POST',
        body: JSON.stringify({ mediaItemId }),
        // A hung call must reject (and be retried next run), not hold the
        // maintenance run's budget.
        signal: AbortSignal.timeout(10_000),
      },
      this.workerSecret
    );
    if (response.ok) return;
    const code = await response
      .json()
      .then((body) => (body as { error?: { code?: unknown } }).error?.code)
      .catch(() => undefined);
    if (refusesForGood(response.status)) {
      this.obs?.error('Publish-when-ready call refused by content-api', {
        mediaId: mediaItemId,
        status: response.status,
        code: typeof code === 'string' ? code : undefined,
      });
    }
    throw new InternalServiceError(`content-api answered ${response.status}`, {
      status: response.status,
    });
  }
}
