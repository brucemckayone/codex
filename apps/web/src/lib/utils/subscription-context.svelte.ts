/**
 * Reactive subscription context for content detail pages.
 *
 * Two-layer pattern (Codex-twzso, extracted Codex-jrpdx):
 *   1. `promiseSubCtx` — seeded from the server-streamed subscriptionContext
 *      promise (SSR initial paint).
 *   2. `subCtx` $derived — prefers the live row from `subscriptionCollection`
 *      (localStorage-backed) when present, otherwise falls back to
 *      promiseSubCtx. This lets webhook-driven subscription updates flip the
 *      gate in the window between landing and the org layout's
 *      `invalidate('cache:org-versions')` firing.
 *
 * Behaviour preserved identically from the previous inline wrappers
 * (`_org/[slug]/(space)/content/[contentSlug]/+page.svelte` and
 * `_creators/[username]/content/[contentSlug]/+page.svelte`):
 *   - `enableSubscriptions = false` zeros out state and breaks out of the
 *     effect before resolving any promise.
 *   - The stale-promise guard (`resolvedSubPromise === promise`) discards
 *     resolutions that arrive after the user has navigated to a different
 *     content item, preventing content A's subscription state from
 *     overwriting content B.
 *   - When the promise is null, state resets to zeroed + null guard.
 *
 * The narrower client view of `SubscriptionContext` (Codex-lqvw4.16) is
 * expressed via `Pick<>` — the canonical type lives in `$lib/types` (moved
 * out of `$lib/server/content-detail.ts` so client modules can import it
 * without crossing the SvelteKit server boundary).
 */

import { untrack } from 'svelte';
import { browser } from '$app/environment';
import { subscriptionCollection } from '$lib/collections';
import type { SubscriptionContext, SubscriptionTier } from '$lib/types';

type ResolvedSubscriptionContext = Pick<
  SubscriptionContext,
  | 'requiresSubscription'
  | 'hasSubscription'
  | 'subscriptionCoversContent'
  | 'tiers'
>;

interface UseSubscriptionContextParams {
  /** Server-streamed promise from `loadSubscriptionContext()` */
  subscriptionContext: Promise<ResolvedSubscriptionContext> | null | undefined;
  /** Org ID used to look up the live subscription row. Null = personal content. */
  organizationId: string | null | undefined;
  /** Feature flag — when false, all subscription state is zeroed. */
  enableSubscriptions: boolean;
  /** Content access type — `'subscribers'` means subscription is required. */
  accessType: string;
  /** Minimum tier ID — when set, subscription must meet this tier's sortOrder. */
  minimumTierId: string | null | undefined;
}

interface SubCtx {
  requiresSubscription: boolean;
  hasSubscription: boolean;
  subscriptionCoversContent: boolean;
}

export function useSubscriptionContext(
  getParams: () => UseSubscriptionContextParams
) {
  const initial = getParams();
  let promiseSubCtx = $state<SubCtx>({
    requiresSubscription: initial.enableSubscriptions
      ? initial.accessType === 'subscribers' || !!initial.minimumTierId
      : false,
    hasSubscription: false,
    subscriptionCoversContent: false,
  });
  let resolvedTiers = $state<SubscriptionTier[]>([]);

  // Guard against stale promise resolution when navigating between content
  // items. Without this, content A's subscriptionContext can resolve after
  // navigating to B and overwrite B's subscription state with A's data.
  let resolvedSubPromise: Promise<unknown> | null = null;

  $effect(() => {
    const {
      subscriptionContext: promise,
      enableSubscriptions,
      accessType,
      minimumTierId,
    } = getParams();

    if (!enableSubscriptions) {
      untrack(() => {
        promiseSubCtx = {
          requiresSubscription: false,
          hasSubscription: false,
          subscriptionCoversContent: false,
        };
        resolvedTiers = [];
        resolvedSubPromise = null;
      });
      return;
    }

    untrack(() => {
      if (promise && promise !== resolvedSubPromise) {
        resolvedSubPromise = promise;
        promise.then((ctx) => {
          if (resolvedSubPromise === promise) {
            promiseSubCtx = {
              requiresSubscription: ctx.requiresSubscription,
              hasSubscription: ctx.hasSubscription,
              subscriptionCoversContent: ctx.subscriptionCoversContent,
            };
            resolvedTiers = ctx.tiers ?? [];
          }
        });
      } else if (!promise) {
        promiseSubCtx = {
          requiresSubscription: accessType === 'subscribers' || !!minimumTierId,
          hasSubscription: false,
          subscriptionCoversContent: false,
        };
        resolvedTiers = [];
        resolvedSubPromise = null;
      }
    });
  });

  // Live subscription override — reads from the localStorage-backed
  // subscriptionCollection so webhook-driven updates flip the gate without
  // waiting for a server reload. Server-safe via `browser` guard.
  const liveSubscription = $derived.by(() => {
    const { organizationId, enableSubscriptions } = getParams();
    if (!browser || !enableSubscriptions || !organizationId) return null;
    const entry = subscriptionCollection?.state.get(organizationId) ?? null;
    // Only access-granting states flip the gate. paused / past_due /
    // cancelled / incomplete rows persist for UI (Resume button, past-due
    // alert) but must not short-circuit the content-detail access check —
    // backend @codex/access would 403 the stream click anyway.
    if (!entry) return null;
    return entry.status === 'active' || entry.status === 'cancelling'
      ? entry
      : null;
  });

  const subCtx = $derived.by<SubCtx>(() => {
    const sub = liveSubscription;
    if (sub) {
      const { accessType, minimumTierId } = getParams();
      const requiresSubscription =
        accessType === 'subscribers' || !!minimumTierId;
      let subscriptionCoversContent = false;
      if (!minimumTierId) {
        // Any active subscription grants access when no min tier is set.
        subscriptionCoversContent = true;
      } else {
        const minTier = resolvedTiers.find((t) => t.id === minimumTierId);
        subscriptionCoversContent = minTier
          ? sub.tier.sortOrder >= minTier.sortOrder
          : false;
      }
      return {
        requiresSubscription,
        hasSubscription: true,
        subscriptionCoversContent,
      };
    }
    return promiseSubCtx;
  });

  return {
    get subCtx() {
      return subCtx;
    },
  };
}
