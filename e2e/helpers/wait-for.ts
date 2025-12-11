/**
 * Wait-for helpers for async operations in e2e tests
 */

import type { Database } from '@codex/database';
import { schema } from '@codex/database';
import { eq } from 'drizzle-orm';

/**
 * Generic wait-for with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  options: {
    timeout?: number;
    interval?: number;
    timeoutMessage?: string;
  } = {}
): Promise<void> {
  const {
    timeout = 10000,
    interval = 100,
    timeoutMessage = 'Timeout waiting for condition',
  } = options;

  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(timeoutMessage);
}

/**
 * Wait for Stripe webhook to be processed (purchase recorded)
 */
export async function waitForWebhook(
  db: Database,
  stripePaymentIntentId: string,
  timeout = 5000
): Promise<void> {
  await waitFor(
    async () => {
      const purchase = await db.query.purchases.findFirst({
        where: eq(
          schema.purchases.stripePaymentIntentId,
          stripePaymentIntentId
        ),
      });
      return !!purchase;
    },
    {
      timeout,
      timeoutMessage: `Timeout waiting for webhook to process payment intent: ${stripePaymentIntentId}`,
    }
  );
}

/**
 * Wait for media to finish transcoding
 */
export async function waitForMediaReady(
  db: Database,
  mediaItemId: string,
  timeout = 30000
): Promise<void> {
  await waitFor(
    async () => {
      const media = await db.query.mediaItems.findFirst({
        where: eq(schema.mediaItems.id, mediaItemId),
      });
      return media?.status === 'ready';
    },
    {
      timeout,
      timeoutMessage: `Timeout waiting for media to be ready: ${mediaItemId}`,
    }
  );
}
