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
 *   - through {@link getLibraryDisputeState}, the org landing's "Jump back
 *     in" rail and the org library (rows and resume rail)
 *   - through {@link getEnrolledCourseAccessState}, the org library's course
 *     shelf ("Your portals" and the courses in its resume rail)
 *
 * Design constraints (P2 decoration — see bead):
 *   - Only subscription-gated entries are joined. Membership-gated items
 *     always render untouched, and a purchased item changes only while a
 *     payment dispute on it is open (Codex-2hxff.60).
 *   - We only know the subscription status for orgs the user has
 *     visited (subscriptionCollection is populated on org-layout mount).
 *     When the map has no entry we return `active` — conservative default
 *     so orgs the user has not recently visited don't grey out.
 *   - 'cancelling' keeps the card fully interactive (access still valid)
 *     and adds a corner badge.
 *   - 'past_due' also keeps the card fully interactive (a failed renewal
 *     keeps access while Stripe retries) and adds a "payment failed" badge.
 *   - 'paused' dims the card and swaps the CTA overlay.
 */

import type { SubscriptionItem } from '$lib/collections';
import { getEffectiveStatus } from './status';

/**
 * The shape consumers need from a library item.
 * Deliberately narrow so we can test without the full `LibraryItem` type.
 */
interface LibraryAccessInput {
  /**
   * The library item's accessType — only `'subscription'` triggers joins; every
   * other route is unconditionally active.
   *
   * This lists the FULL union the API returns. It previously named only
   * `purchased | membership | subscription`, which made the long-shipping
   * `'free'` and `'followers'` values look impossible — the mismatch stayed
   * invisible while `@codex/access` published an under-declared copy of the
   * library contract. Runtime behaviour is unchanged: those values already fell
   * through the `!== 'subscription'` guard to "active".
   */
  accessType:
    | 'purchased'
    | 'membership'
    | 'subscription'
    | 'free'
    | 'followers';
  /** Slug of the owning org (join key against subscriptionCollection). */
  organizationSlug: string | null;
  /**
   * `purchase.disputedAt` of the library row: set while a chargeback on the
   * purchase is open. The library lists only completed purchases and a won
   * dispute clears the mark, so "set" means "open". A row cached before the
   * field shipped has none; callers pass `null` for it.
   */
  purchaseDisputedAt: string | null;
}

/**
 * Possible UI access states for a library card.
 *
 *   active     — no visual change (fully accessible)
 *   cancelling — corner badge "Ends {date}"; card stays fully accessible
 *   revoked    — dimmed card + hover CTA "Subscription ended — reactivate"
 *   past_due   — corner badge "Payment failed — update payment"; card stays
 *                fully accessible while Stripe retries the card
 *   disputed   — dimmed card + label "Paused: payment dispute", always shown;
 *                a purchase with an open payment dispute
 */
type LibraryAccessState =
  | { kind: 'active' }
  | { kind: 'cancelling'; periodEnd: string }
  | { kind: 'revoked' }
  | { kind: 'past_due' }
  | { kind: 'disputed' };

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
 *   - Purchased item with an open dispute       → disputed
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
  subscriptionsBySlug: ReadonlyMap<string, SubscriptionItem>
): LibraryAccessState {
  if (item.accessType === 'purchased' && item.purchaseDisputedAt != null) {
    return { kind: 'disputed' };
  }
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
    // No tier => no subscription to speak of.
    case null:
      return { kind: 'revoked' };
  }
}

/** No subscription rows: every subscription item stays `active`. */
const NO_SUBSCRIPTION_JOIN: ReadonlyMap<string, SubscriptionItem> = new Map();

/**
 * {@link getLibraryAccessState} for a surface that never joined the
 * subscription collection (the org landing's "Jump back in" rail, the org
 * library): the same rule, with no subscription rows, so the only state it
 * can add there is `disputed` (Codex-2hxff.60). Those surfaces never showed
 * "Subscription ended", and this does not start them doing so.
 */
export function getLibraryDisputeState(
  item: LibraryAccessInput
): LibraryAccessState {
  return getLibraryAccessState(item, NO_SUBSCRIPTION_JOIN);
}

/**
 * The same state for an enrolled course on the org library's course shelf
 * (Codex-2hxff.60): `disputed` while the worker's `disputeHold` says an open
 * payment dispute on the course purchase or the course subscription holds the
 * grant back, so the card dims and carries the library's label. The worker
 * sets it exactly when the course's lessons show the dispute notice, so no
 * second rule is needed here. A missing field (a worker older than it) reads
 * as `active`.
 */
export function getEnrolledCourseAccessState(course: {
  disputeHold?: string | null;
}): LibraryAccessState {
  return course.disputeHold != null ? { kind: 'disputed' } : { kind: 'active' };
}
