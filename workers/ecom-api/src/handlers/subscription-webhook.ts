/**
 * Subscription Webhook Handlers
 *
 * Processes Stripe subscription lifecycle events:
 * - checkout.session.completed (mode=subscription) → create subscription record
 * - customer.subscription.updated → handle tier changes, status changes
 * - customer.subscription.deleted → mark cancelled
 * - invoice.payment_succeeded → extend period, execute revenue transfers
 * - invoice.payment_failed → update status to past_due
 *
 * Business logic (DB queries, email composition, tier lookups) lives in
 * SubscriptionService — this handler only orchestrates Stripe event extraction,
 * service calls, revocation writes/clears, and fire-and-forget email dispatch.
 *
 * Cache invalidation is owned by `SubscriptionService` itself via an
 * orchestrator hook inside each `handle*` method (see `invalidateIfConfigured`
 * in `packages/subscription/src/services/subscription-service.ts`). The
 * handler here wires `VersionedCache` + `waitUntil` into the service via
 * its constructor — the service then bumps both per-user version keys
 * (COLLECTION_USER_LIBRARY + COLLECTION_USER_SUBSCRIPTION) on success.
 *
 * Revocation (writes on access-reducing events, clears on access-restoring
 * events) is a separate concern and stays in this handler.
 *
 * Security:
 * - Signature already verified by verifyStripeSignature middleware
 * - Idempotent via stripeSubscriptionId unique constraint
 */

import { AccessRevocation, type RevocationReason } from '@codex/access';
import { VersionedCache } from '@codex/cache';
import { STRIPE_EVENTS } from '@codex/constants';
import { createPerRequestDbClient } from '@codex/database';
import type { WebhookHandlerResult } from '@codex/subscription';
import { SubscriptionService, TierService } from '@codex/subscription';
import { sendEmailToWorker } from '@codex/worker-utils';
import type { Context } from 'hono';
import type Stripe from 'stripe';
import type { StripeWebhookEnv } from '../types';

/**
 * Fire-and-forget write of a per-user, per-org KV revocation key after a
 * Stripe event that REDUCES access (subscription deleted, payment failed,
 * refund). Checked by `ContentAccessService.getStreamingUrl()` to close the
 * window where a presigned R2 URL issued before revocation is still usable.
 *
 * See packages/access/src/services/access-revocation.ts and
 * docs/subscription-cache-audit/phase-2-followup.md for the design.
 *
 * No-op when:
 *   - CACHE_KV binding absent (dev stub / misconfigured env) — revocation is
 *     authoritative block-list but its absence falls open to the DB check
 *   - `userId` or `orgId` missing — revocation is org-scoped per-user, so
 *     without both identifiers there is no key to write
 *
 * Errors are caught inside the `waitUntil` promise so a KV hiccup never
 * surfaces as a webhook 500 (Stripe would retry unnecessarily).
 */
function revokeAccess(
  c: Context<StripeWebhookEnv>,
  result: WebhookHandlerResult | void,
  reason: RevocationReason
): void {
  if (!c.env.CACHE_KV) return;
  if (!result?.userId || !result?.orgId) return;

  const obs = c.get('obs');
  const revocation = new AccessRevocation(c.env.CACHE_KV, obs);
  const userId = result.userId;
  const orgId = result.orgId;

  try {
    c.executionCtx.waitUntil(
      revocation.revoke(userId, orgId, reason).catch((error) => {
        obs?.warn('subscription-webhook: AccessRevocation.revoke failed', {
          reason,
          userId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    // Defensive: waitUntil itself throwing synchronously (e.g. mock harness
    // or a future runtime change) must not crash the webhook.
    obs?.warn('subscription-webhook: waitUntil threw synchronously', {
      reason,
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Fire-and-forget CLEAR of a per-user, per-org KV revocation key after a
 * Stripe event that RESTORES access (subscription updated → active after a
 * non-active state, invoice paid after PAST_DUE). Mirror of `revokeAccess`
 * from Codex-usgf7 — same guards, same fire-and-forget semantics.
 *
 * KV delete is idempotent: calling clear with no matching key is a no-op.
 * We deliberately do NOT guard on "only clear if present" — checking first
 * would double the KV round-trips for the common case and does not buy
 * safety. Over-clearing is free.
 *
 * No-op when:
 *   - CACHE_KV binding absent (dev stub / misconfigured env)
 *   - `userId` or `orgId` missing — revocation is org-scoped per-user, so
 *     without both identifiers there is no key to clear
 *
 * Errors are swallowed inside the `waitUntil` promise so a KV hiccup never
 * surfaces as a webhook 500 (Stripe would retry unnecessarily).
 *
 * See bead Codex-13ml3 and docs/subscription-cache-audit/phase-2-followup.md.
 */
function clearAccess(
  c: Context<StripeWebhookEnv>,
  result: WebhookHandlerResult | void
): void {
  if (!c.env.CACHE_KV) return;
  if (!result?.userId || !result?.orgId) return;

  const obs = c.get('obs');
  const revocation = new AccessRevocation(c.env.CACHE_KV, obs);
  const userId = result.userId;
  const orgId = result.orgId;

  try {
    c.executionCtx.waitUntil(
      revocation.clear(userId, orgId).catch((error) => {
        obs?.warn('subscription-webhook: AccessRevocation.clear failed', {
          userId,
          orgId,
          error: error instanceof Error ? error.message : String(error),
        });
      })
    );
  } catch (error) {
    // Defensive: waitUntil itself throwing synchronously (e.g. mock harness
    // or a future runtime change) must not crash the webhook.
    obs?.warn('subscription-webhook: waitUntil threw synchronously (clear)', {
      userId,
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Dispatch email notification from a webhook handler result.
 * Fire-and-forget via sendEmailToWorker (uses waitUntil internally).
 */
function dispatchEmail(
  c: Context<StripeWebhookEnv>,
  result: WebhookHandlerResult | void
): void {
  if (result?.email) {
    sendEmailToWorker(c.env, c.executionCtx, result.email);
  }
}

export async function handleSubscriptionWebhook(
  event: Stripe.Event,
  stripe: Stripe,
  c: Context<StripeWebhookEnv>
) {
  const obs = c.get('obs');
  const webAppUrl = c.env.WEB_APP_URL || '';

  const { db, cleanup } = createPerRequestDbClient({
    DATABASE_URL: c.env.DATABASE_URL,
    DATABASE_URL_LOCAL_PROXY: c.env.DATABASE_URL_LOCAL_PROXY,
    DB_METHOD: c.env.DB_METHOD,
  });

  try {
    // Wire the cache + waitUntil orchestrator hook so every `handle*`
    // method on SubscriptionService bumps the per-user library +
    // per-org subscription KV version keys internally on success. The
    // webhook no longer calls `invalidateForUser` directly — the
    // service owns invalidation. Mirror of the service-registry wiring
    // used by `procedure()` routes.
    const cache = c.env.CACHE_KV
      ? new VersionedCache({ kv: c.env.CACHE_KV, prefix: 'cache' })
      : undefined;
    const waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);

    // Q1.3 (Codex-7kc83): wire a mailer thunk so Dashboard-originated
    // price changes (price.created → applyStripePriceCreated →
    // propagateTierPriceToActiveSubscriptions) notify each affected
    // subscriber. Mirrors the service-registry wiring used by
    // `procedure()` routes. Same fire-and-forget semantics as
    // cache invalidation: the webhook response returns 200 immediately
    // and emails land on `waitUntil`.
    const mailer = (params: {
      to: string;
      toName?: string;
      templateName: 'subscription-tier-price-change';
      category: 'transactional';
      userId?: string;
      organizationId?: string | null;
      data: Record<string, string | number | boolean>;
    }) => {
      sendEmailToWorker(c.env, c.executionCtx, params);
    };

    const service = new SubscriptionService(
      {
        db,
        environment: c.env.ENVIRONMENT || 'development',
        cache,
        waitUntil,
        mailer,
        webAppUrl: c.env.WEB_APP_URL,
      },
      stripe
    );

    // TierService is constructed lazily — only `product.updated` and
    // `price.created` events use it for Dashboard sync-back. All other
    // events fall through to SubscriptionService.
    //
    // Q1.2 (Codex-3xyyb): inject a propagator thunk so
    // `applyStripePriceCreated` fans the newly-adopted canonical Price
    // id out to every active/cancelling subscription on the tier. The
    // propagator runs on `executionCtx.waitUntil` — the webhook returns
    // 200 immediately, and the per-sub Stripe updates (batched inside
    // the service) complete asynchronously. This keeps the webhook
    // response well under Stripe's delivery-timeout window even for
    // tiers with many subscribers. The inner method owns per-sub error
    // handling; a fire-and-forget catch on the outer promise just
    // prevents unhandled-rejection noise on a catastrophic failure.
    const tierService = new TierService(
      {
        db,
        environment: c.env.ENVIRONMENT || 'development',
        propagator: (args) => {
          c.executionCtx.waitUntil(
            service
              .propagateTierPriceToActiveSubscriptions(
                args.tierId,
                args.newStripePriceId,
                { organizationId: args.organizationId }
              )
              .then(() => undefined)
              .catch((error) => {
                obs?.warn(
                  'subscription-webhook: propagateTierPriceToActiveSubscriptions threw (tail caught)',
                  {
                    tierId: args.tierId,
                    organizationId: args.organizationId,
                    newStripePriceId: args.newStripePriceId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  }
                );
              })
          );
        },
      },
      stripe
    );

    /**
     * Fire-and-forget org-level cache invalidation after a Stripe
     * Dashboard sync-back write. Bumps the org's version key which
     * stales `ORG_TIERS` + `ORG_CONFIG` + every other org-scoped cache
     * in one KV write. No-op when CACHE_KV is absent or the sync-back
     * reported `changed: false` (idempotent replay).
     */
    const invalidateOrgAfterSyncBack = (
      result: {
        tierId: string;
        organizationId: string;
        changed: boolean;
      } | null
    ): void => {
      if (!cache || !result?.changed) return;
      try {
        c.executionCtx.waitUntil(
          cache.invalidate(result.organizationId).catch((error) => {
            obs?.warn(
              'subscription-webhook: org cache invalidation failed after Dashboard sync-back',
              {
                organizationId: result.organizationId,
                tierId: result.tierId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          })
        );
      } catch (error) {
        obs?.warn(
          'subscription-webhook: waitUntil threw synchronously (sync-back invalidate)',
          {
            organizationId: result.organizationId,
            tierId: result.tierId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      }
    };

    switch (event.type) {
      case STRIPE_EVENTS.CHECKOUT_COMPLETED: {
        const session = event.data.object as Stripe.Checkout.Session;
        // Only handle subscription-mode checkouts
        if (session.mode !== 'subscription') return;

        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (!subscriptionId) {
          obs?.warn('Subscription checkout missing subscription ID', {
            sessionId: session.id,
          });
          return;
        }

        // Retrieve the full subscription object for period dates + metadata
        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);
        // `handleSubscriptionCreated` owns its own cache invalidation via
        // the orchestrator hook inside SubscriptionService.
        const result = await service.handleSubscriptionCreated(
          subscription,
          webAppUrl
        );

        dispatchEmail(c, result);

        obs?.info('Subscription created from checkout', {
          sessionId: session.id,
          subscriptionId,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_UPDATED: {
        const subscription = event.data.object as Stripe.Subscription;
        // `handleSubscriptionUpdated` owns its own cache invalidation via
        // the orchestrator hook inside SubscriptionService. Tier changes
        // and status flips (active ↔ cancelling ↔ past_due) all bump
        // both per-user version keys from inside the service.
        const result = await service.handleSubscriptionUpdated(subscription);

        // Revocation is deliberately NOT written here by default:
        //  - `cancel_at_period_end=true` toggles status to CANCELLING but
        //    the user has paid access through `currentPeriodEnd` (product
        //    decision — see docs/subscription-cache-audit/phase-2-followup.md)
        //  - mid-subscription tier changes do not reduce access
        //  - transitions TO active (reactivation) are handled by a sibling
        //    bead (Codex-13ml3) which issues `revocation.clear`
        //
        // The one exception is the rare Stripe status `unpaid`, which is a
        // reduced-access state not covered by the other events. Guard on
        // that specifically so we don't accidentally revoke on any other
        // `customer.subscription.updated` flavour.
        if (subscription.status === 'unpaid') {
          revokeAccess(c, result, 'payment_failed');
        }

        // Access-RESTORING transition: Stripe reports status=active. The
        // user may have been in a non-active state before this event (e.g.
        // `unpaid` → `active` after a dispute resolution, or `past_due` →
        // `active` outside of the invoice.payment_succeeded path). We take
        // the conservative approach: always clear on status=active. KV
        // delete is idempotent — if no revocation key exists, it's a free
        // no-op; if one does, this restores access within the KV TTL.
        //
        // `cancel_at_period_end=true` also reports status=active; the user
        // never had access revoked in that case (see the comment above on
        // the non-write path) so the clear is still safe — there's simply
        // no key to delete.
        //
        // See bead Codex-13ml3 (clear counterpart to Codex-usgf7 writes).
        if (subscription.status === 'active') {
          clearAccess(c, result);
        }

        obs?.info('Subscription updated', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_DELETED: {
        const subscription = event.data.object as Stripe.Subscription;
        // `handleSubscriptionDeleted` owns its own cache invalidation via
        // the orchestrator hook inside SubscriptionService.
        const result = await service.handleSubscriptionDeleted(
          subscription,
          webAppUrl
        );

        // Revocation list write: close the presigned-URL window. Paired
        // with a shortened streaming URL TTL in ContentAccessService, this
        // limits post-cancellation stream access to the URL TTL rather
        // than the (longer) cache invalidation propagation window.
        revokeAccess(c, result, 'subscription_deleted');
        dispatchEmail(c, result);

        obs?.info('Subscription deleted', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_PAUSED: {
        const subscription = event.data.object as Stripe.Subscription;
        // `handleSubscriptionPaused` owns its own cache invalidation via
        // the orchestrator hook inside SubscriptionService (reason:
        // 'subscription_paused'). See bead Codex-a0vk2.
        const result = await service.handleSubscriptionPaused(subscription);

        // Revocation write: pause reduces access for the paused window,
        // same invariant as subscription_deleted (`isRevoked(...)` returns
        // non-null → ContentAccessService denies the stream). Reason tag
        // reuses `'subscription_deleted'` because `RevocationReason` in
        // `@codex/access` does not include `'subscription_paused'` today —
        // the revocation keyspace is binary (present or not) and the reason
        // is observability-only, never used for branching. The sibling
        // `customer.subscription.resumed` handler (bead Codex-rh0on) clears
        // this via the existing `clearAccess` helper path.
        revokeAccess(c, result, 'subscription_deleted');

        obs?.info('Subscription paused', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_RESUMED: {
        const subscription = event.data.object as Stripe.Subscription;
        // `handleSubscriptionResumed` owns its own cache invalidation via
        // the orchestrator hook inside SubscriptionService (reason:
        // 'subscription_resumed'). Counterpart to SUBSCRIPTION_PAUSED —
        // flips status back to ACTIVE. See bead Codex-rh0on.
        const result = await service.handleSubscriptionResumed(subscription);

        // Revocation CLEAR: the paused event wrote a revocation key; the
        // resume must clear it so already-minted presigned URLs (issued
        // before the pause) do not stay gated beyond the resume. KV delete
        // is idempotent — if no key exists (e.g. paused event never landed,
        // or TTL already expired), the clear is a free no-op. Mirror of
        // the clear paths in SUBSCRIPTION_UPDATED(status=active) and
        // INVOICE_PAYMENT_SUCCEEDED.
        clearAccess(c, result);

        obs?.info('Subscription resumed', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.INVOICE_PAYMENT_SUCCEEDED: {
        const invoice = event.data.object as Stripe.Invoice;
        // `handleInvoicePaymentSucceeded` owns its own cache invalidation
        // via the orchestrator hook inside SubscriptionService. Renewal
        // continues access — both per-user version keys are bumped from
        // inside the service.
        const result = await service.handleInvoicePaymentSucceeded(
          invoice,
          webAppUrl
        );

        // Access-RESTORING: a successful payment confirms the invoice is
        // settled. If the subscription was previously PAST_DUE, its
        // revocation key still lives in KV (TTL = 1200s, 2× the max
        // presigned URL TTL). Clear it unconditionally — the payment
        // succeeded, so access should be unblocked. KV delete is
        // idempotent: a clear on a subscription that never went past_due
        // is a free no-op. See bead Codex-13ml3.
        clearAccess(c, result);
        dispatchEmail(c, result);

        obs?.info('Invoice payment succeeded', {
          invoiceId: invoice.id,
        });
        break;
      }

      case STRIPE_EVENTS.SUBSCRIPTION_TRIAL_WILL_END: {
        const subscription = event.data.object as Stripe.Subscription;
        // Trial-will-end is NOT access-reducing — the user is still inside
        // the trial. By design this handler:
        //   - does NOT write a revocation key (access continues)
        //   - does NOT invalidate caches (library + subscription badge
        //     are unchanged, so other devices have nothing to re-fetch)
        //   - ONLY dispatches a `trial-ending-soon` email
        // See `SubscriptionService.handleTrialWillEnd` for the rationale.
        const result = await service.handleTrialWillEnd(
          subscription,
          webAppUrl
        );

        dispatchEmail(c, result);

        obs?.info('Subscription trial will end', {
          subscriptionId: subscription.id,
        });
        break;
      }

      case STRIPE_EVENTS.PRODUCT_UPDATED: {
        // Q1 product decision: Dashboard edits to Codex-managed tier
        // Products auto-propagate back to subscriptionTiers. Mirrors
        // name + description only (active flag is reserved for Codex's
        // own soft-delete path — see TierService.applyStripeProductUpdate).
        const product = event.data.object as Stripe.Product;
        const syncResult = await tierService.applyStripeProductUpdate(product);

        if (syncResult?.changed) {
          obs?.info('Synced Stripe Dashboard product edit to tier', {
            tierId: syncResult.tierId,
            organizationId: syncResult.organizationId,
            stripeProductId: product.id,
            eventId: event.id,
          });
          invalidateOrgAfterSyncBack(syncResult);
        }
        break;
      }

      case STRIPE_EVENTS.PRICE_CREATED: {
        // Q1 product decision (sync-back part b): when a Dashboard
        // operator creates a new Price on a Codex-managed Product (the
        // workflow for changing an amount, because Stripe Prices are
        // immutable), adopt it as canonical for the tier+interval and
        // archive whichever Price the tier previously referenced.
        // See TierService.applyStripePriceCreated for the idempotency
        // + metadata contract.
        const price = event.data.object as Stripe.Price;
        const syncResult = await tierService.applyStripePriceCreated(price);

        if (syncResult?.changed) {
          obs?.info('Adopted Stripe Dashboard-created Price as canonical', {
            tierId: syncResult.tierId,
            organizationId: syncResult.organizationId,
            stripePriceId: price.id,
            eventId: event.id,
          });
          invalidateOrgAfterSyncBack(syncResult);
        }
        break;
      }

      case STRIPE_EVENTS.PRICE_UPDATED: {
        // Stripe Prices are immutable (amount/currency/interval), so only
        // metadata + nickname + active flip fire this event. Adoption of
        // replacement Prices happens on PRICE_CREATED (Dashboard workflow
        // for amount changes is "create new, archive old"). This arm is
        // therefore detect-only: an archive-without-replacement (operator
        // error) or a metadata/nickname edit is logged as obs.error so
        // operators see the drift but no sync-back happens here.
        const price = event.data.object as Stripe.Price;
        if (price.metadata?.codex_organization_id) {
          obs?.error('Codex-managed tier Price edited in Stripe Dashboard', {
            stripePriceId: price.id,
            organizationId: price.metadata.codex_organization_id,
            priceActive: price.active,
            eventId: event.id,
          });
        }
        break;
      }

      case STRIPE_EVENTS.INVOICE_PAYMENT_FAILED: {
        const invoice = event.data.object as Stripe.Invoice;
        obs?.warn('Invoice payment failed', {
          invoiceId: invoice.id,
          amountDue: invoice.amount_due,
        });

        // `handleInvoicePaymentFailed` owns its own cache invalidation
        // via the orchestrator hook inside SubscriptionService. The
        // PAST_DUE flip bumps both per-user version keys from inside
        // the service.
        const result = await service.handleInvoicePaymentFailed(
          invoice,
          webAppUrl
        );

        // PAST_DUE is access-reducing: `handleInvoicePaymentFailed` only
        // returns userId+orgId once the local subscription record has been
        // flipped to PAST_DUE, so revokeAccess's guard (requires both ids)
        // naturally gates on that transition.
        revokeAccess(c, result, 'payment_failed');
        dispatchEmail(c, result);
        break;
      }

      default:
        obs?.info('Unhandled subscription webhook event', {
          type: event.type,
        });
    }
  } finally {
    await cleanup();
  }
}
