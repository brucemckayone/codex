/**
 * The composition root for code that runs outside `procedure()`: Stripe
 * webhooks and crons (Codex-2hxff.54; WP2 in docs/payments/architecture.md).
 *
 * Routes get their services from the registry `procedure()` builds. Webhooks
 * and crons used to build theirs by hand, as eight `new *Service({ db,
 * environment })` sites in ecom-api, and each missed something the registry
 * wires: FeeConfigService (so a configured fee never reached a real sale,
 * Codex-2hxff.7), the money mailers (Codex-2hxff.13), the cache hooks and the
 * tier propagator. This builds the SAME registry, so a dependency added there
 * reaches every path at once.
 */

import type { ObservabilityClient } from '@codex/observability';
import type { Bindings } from '@codex/shared-types';
import type { MediaStatusFeed } from '@codex/transcoding';
import type Stripe from 'stripe';
import { createServiceRegistry } from './procedure/service-registry';
import type { ServiceRegistry } from './procedure/types';
import {
  type BackgroundTracker,
  createBackgroundTracker,
} from './procedure/upload-shared';

export interface WebhookServices {
  services: ServiceRegistry;
  /**
   * Run work after the response on the services' shared pool (a payout drain
   * started by the webhook). `release` waits for it, as `procedure()` waits
   * for a route's `ctx.background`.
   */
  background: BackgroundTracker['background'];
  /**
   * Close the pool once every background task the services registered (an
   * email that looks its recipient up, a price fan-out) has settled. Plain
   * `waitUntil(cleanup())` would race those tasks and win, failing their
   * queries (see `createBackgroundTracker`). Scheduled on `waitUntil`, so it
   * never delays the response. Call it once, in `finally`.
   */
  release: () => void;
}

export async function createWebhookServices(
  env: Bindings,
  executionCtx: ExecutionContext,
  options: {
    obs?: ObservabilityClient;
    stripe?: Stripe;
    /** See ServiceRegistryOverrides.mediaStatus. */
    mediaStatus?: MediaStatusFeed;
  } = {}
): Promise<WebhookServices> {
  const tracker = createBackgroundTracker();
  const { registry, cleanup } = await createServiceRegistry(
    env,
    options.obs,
    undefined,
    executionCtx,
    undefined,
    tracker.background,
    {
      stripe: options.stripe,
      skipHyperdrive: true,
      mediaStatus: options.mediaStatus,
    }
  );

  return {
    services: registry,
    background: tracker.background,
    release: () => {
      executionCtx.waitUntil(
        tracker
          .settled()
          .then(cleanup)
          .catch((error: unknown) => {
            options.obs?.error('Webhook service cleanup failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
      );
    },
  };
}
