/**
 * Library-access state join helpers (Codex-k7ppt).
 *
 * Joins a library item (`organizationSlug`, `accessType`) against the
 * client-side subscription collection to produce the UI access state a
 * library card should render. Purely functional — no collection/runtime
 * imports, so it can be unit-tested without TanStack DB.
 *
 * Consumed by:
 *   - LibraryPageView.svelte (grid)
 *   - ContinueWatching.svelte (rail)
 *
 * Design constraints (P2 decoration — see bead):
 *   - Only subscription-gated entries are affected. Purchased and
 *     membership-gated items always render untouched.
 *   - We only know the subscription status for orgs the user has
 *     visited (subscriptionCollection is populated on org-layout mount).
 *     When the map has no entry we return `active` — conservative default
 *     so orgs the user has not recently visited don't grey out.
 *   - 'cancelling' keeps the card fully interactive (access still valid)
 *     and adds a corner badge.
 *   - 'past_due' / 'paused' dim the card and swap the CTA overlay.
 */

import type { SubscriptionItem } from '$lib/collections';
import { getEffectiveStatus } from './status';

/**
 * The shape consumers need from a library item.
 * Deliberately narrow so we can test without the full `LibraryItem` type.
 */
export interface LibraryAccessInput {
  /** The library item's accessType — only 'subscription' triggers joins. */
  accessType: 'purchased' | 'membership' | 'subscription';
  /** Slug of the owning org (join key against subscriptionCollection). */
  organizationSlug: string | null;
}

/**
 * Possible UI access states for a library card.
 *
 *   active     — no visual change (fully accessible)
 *   cancelling — corner badge "Ends {date}"; card stays fully accessible
 *   revoked    — dimmed card + hover CTA "Subscription ended — reactivate"
 *   past_due   — dimmed card + hover CTA "Payment failed — update payment"
 */
export type LibraryAccessState =
  | { kind: 'active' }
  | { kind: 'cancelling'; periodEnd: string }
  | { kind: 'revoked' }
  | { kind: 'past_due' };

/**
 * Build a slug → SubscriptionItem map from the collection values.
 * Accepts any iterable so callers can pass `.values()` directly.
 *
 * Entries without an `organizationSlug` (older localStorage rows written
 * before Codex-k7ppt) are skipped — they can't be joined by slug.
 */
export function indexSubscriptionsBySlug(
  subscriptions: Iterable<SubscriptionItem>
): Map<string, SubscriptionItem> {
  const bySlug = new Map<string, SubscriptionItem>();
  for (const sub of subscriptions) {
    if (sub.organizationSlug) bySlug.set(sub.organizationSlug, sub);
  }
  return bySlug;
}

/**
 * Resolve a library item's access state.
 *
 * Join rules:
 *   - Non-subscription items                    → active (no change)
 *   - Subscription item, no slug (edge case)    → active (can't resolve)
 *   - Subscription item, sub entry missing      → active (conservative;
 *     we only populate the collection for orgs the user has visited, so
 *     an absent row likely means "slug not joined yet", not "revoked")
 *   - Subscription item, entry present          → derived via getEffectiveStatus
 *
 * See bead Codex-k7ppt for the rationale on treating "missing" as active:
 * users browsing at platform scope may have subscription content from orgs
 * they haven't visited this session. Greying those out uniformly would
 * produce false negatives.
 */
export function getLibraryAccessState(
  item: LibraryAccessInput,
  subscriptionsBySlug: Map<string, SubscriptionItem>
): LibraryAccessState {
  if (item.accessType !== 'subscription') return { kind: 'active' };
  if (!item.organizationSlug) return { kind: 'active' };

  const sub = subscriptionsBySlug.get(item.organizationSlug);
  if (!sub) return { kind: 'active' };

  const effective = getEffectiveStatus({
    currentTierId: sub.tier?.id ?? null,
    status: sub.status,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
  });

  switch (effective) {
    case 'active':
      return { kind: 'active' };
    case 'cancelling':
      return { kind: 'cancelling', periodEnd: sub.currentPeriodEnd };
    case 'past_due':
      return { kind: 'past_due' };
    case 'paused':
      // Paused is not a stored status today, but if it ever lands we treat
      // it like revoked (no access) — same CTA family.
      return { kind: 'revoked' };
    case null:
    default:
      return { kind: 'revoked' };
  }
}
