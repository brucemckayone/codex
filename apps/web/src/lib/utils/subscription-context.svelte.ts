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
 *
 * Plan access (Codex-2hxff.91): the subscription covers the content when its
 * plan is one of the item's `includedInTierIds` (set membership, never a
 * `sortOrder` ladder), so the live override needs no tier list. The tiers,
 * the viewer's plan, the period end and any waiting move (Codex-2hxff.16)
 * are passed on for the paywall's plan names (`describePlanPaywall`).
 */

import { subscriptionStatusGrantsAccess } from '@codex/constants';
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import { subscriptionCollection } from '$lib/collections';
import type { SubscriptionContext, SubscriptionTier } from '$lib/types';
import type { PendingPlan, PlanListStatus, ViewerPlan } from './plan-label';

type ResolvedSubscriptionContext = Pick<
  SubscriptionContext,
  | 'requiresSubscription'
  | 'hasSubscription'
  | 'subscriptionCoversContent'
  | 'tiers'
> &
  Partial<Pick<SubscriptionContext, 'currentSubscription'>> & {
    /** The tier list failed to load (the server's `tiersFailed`). */
    tiersFailed?: boolean;
  };

interface UseSubscriptionContextParams {
  /** Server-streamed promise from `loadSubscriptionContext()` */
  subscriptionContext: Promise<ResolvedSubscriptionContext> | null | undefined;
  /** Org ID used to look up the live subscription row. Null = personal content. */
  organizationId: string | null | undefined;
  /** Feature flag — when false, all subscription state is zeroed. */
  enableSubscriptions: boolean;
  /**
   * The subscribers-only switch (Codex-2hxff.91): on means a subscription is
   * required, and only a plan in {@link includedInTierIds} covers it.
   */
  isTierGated: boolean | null | undefined;
  /** The plans that include the item; `[]` with the switch on is CLOSED. */
  includedInTierIds: readonly string[] | null | undefined;
}

interface SubCtx {
  requiresSubscription: boolean;
  hasSubscription: boolean;
  subscriptionCoversContent: boolean;
  /** The viewer's access-granting plan, for "Your Pro plan doesn't…". */
  currentPlan: ViewerPlan | null;
  /** When that plan's period ends (ISO), for the change-plan line. */
  currentPeriodEnd: string | null;
  /**
   * Where a move to a cheaper plan goes at the renewal (Codex-2hxff.16):
   * the paywall says when an item in that plan opens.
   */
  pendingPlan: PendingPlan | null;
}

const NO_SUBSCRIPTION = {
  hasSubscription: false,
  subscriptionCoversContent: false,
  currentPlan: null,
  currentPeriodEnd: null,
  pendingPlan: null,
} as const;

/** The waiting move as the paywall reads it; null when nothing waits. */
function pendingPlanOf(
  move:
    | { tierId: string; tierName: string; effectiveAt: string }
    | null
    | undefined
): PendingPlan | null {
  return move
    ? { id: move.tierId, name: move.tierName, effectiveAt: move.effectiveAt }
    : null;
}

export function useSubscriptionContext(
  getParams: () => UseSubscriptionContextParams
) {
  const initial = getParams();
  let promiseSubCtx = $state<SubCtx>({
    requiresSubscription: initial.enableSubscriptions
      ? initial.isTierGated === true
      : false,
    ...NO_SUBSCRIPTION,
  });
  let resolvedTiers = $state<SubscriptionTier[]>([]);
  // Until the streamed context lands the tier list is loading; with no
  // promise to wait on there is no list at all.
  let tiersStatus = $state<PlanListStatus>(
    initial.subscriptionContext ? 'loading' : 'failed'
  );

  // Guard against stale promise resolution when navigating between content
  // items. Without this, content A's subscriptionContext can resolve after
  // navigating to B and overwrite B's subscription state with A's data.
  let resolvedSubPromise: Promise<unknown> | null = null;

  $effect(() => {
    const {
      subscriptionContext: promise,
      enableSubscriptions,
      isTierGated,
    } = getParams();

    if (!enableSubscriptions) {
      untrack(() => {
        promiseSubCtx = { requiresSubscription: false, ...NO_SUBSCRIPTION };
        resolvedTiers = [];
        tiersStatus = 'failed';
        resolvedSubPromise = null;
      });
      return;
    }

    untrack(() => {
      if (promise && promise !== resolvedSubPromise) {
        resolvedSubPromise = promise;
        tiersStatus = 'loading';
        promise
          .then((ctx) => {
            if (resolvedSubPromise === promise) {
              const sub = ctx.hasSubscription
                ? (ctx.currentSubscription ?? null)
                : null;
              promiseSubCtx = {
                requiresSubscription: ctx.requiresSubscription,
                hasSubscription: ctx.hasSubscription,
                subscriptionCoversContent: ctx.subscriptionCoversContent,
                currentPlan: sub
                  ? { id: sub.tier.id, name: sub.tier.name }
                  : null,
                currentPeriodEnd: sub?.currentPeriodEnd ?? null,
                pendingPlan: pendingPlanOf(sub?.pendingTierChange),
              };
              resolvedTiers = ctx.tiers ?? [];
              tiersStatus = ctx.tiersFailed ? 'failed' : 'ready';
            }
          })
          .catch(() => {
            if (resolvedSubPromise === promise) {
              resolvedTiers = [];
              tiersStatus = 'failed';
            }
          });
      } else if (!promise) {
        promiseSubCtx = {
          requiresSubscription: isTierGated === true,
          ...NO_SUBSCRIPTION,
        };
        resolvedTiers = [];
        tiersStatus = 'failed';
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
    // Only access-granting states flip the gate (`past_due` does, while
    // Stripe retries). paused / cancelled / incomplete rows persist for UI
    // (Resume button) but must not short-circuit the content-detail access
    // check — backend @codex/access would 403 the stream click anyway.
    if (!entry) return null;
    return subscriptionStatusGrantsAccess(entry.status) ? entry : null;
  });

  const subCtx = $derived.by<SubCtx>(() => {
    const sub = liveSubscription;
    if (sub) {
      const { isTierGated, includedInTierIds } = getParams();
      const requiresSubscription = isTierGated === true;
      return {
        requiresSubscription,
        hasSubscription: true,
        // Set membership: only a ticked plan covers it, and a gated item
        // with none ticked is covered by no plan (closed). Not gated: any
        // granting subscription covers it, as before.
        subscriptionCoversContent: requiresSubscription
          ? (includedInTierIds?.includes(sub.tier.id) ?? false)
          : true,
        currentPlan: { id: sub.tier.id, name: sub.tier.name },
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
        // An entry written before the field existed reads as nothing waiting.
        pendingPlan: pendingPlanOf(sub.pendingTierChange),
      };
    }
    return promiseSubCtx;
  });

  return {
    get subCtx() {
      return subCtx;
    },
    /** The org's active plans, once the streamed context lands. */
    get tiers() {
      return resolvedTiers;
    },
    get tiersStatus() {
      return tiersStatus;
    },
  };
}
