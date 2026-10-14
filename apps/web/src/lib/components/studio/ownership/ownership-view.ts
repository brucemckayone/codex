/**
 * Pure rules behind the ownership-transfer UI (Codex-2hxff.2).
 *
 * Kept out of the components so each rule is testable on its own and the
 * settings page, the card and the studio banner cannot disagree about one.
 */

import type {
  OwnershipLastOutcome,
  OwnershipView,
  PendingOwnershipOffer,
} from '$lib/types';

/** Offers expire after this many days (owner decision, 2026-10-13). */
export const OWNERSHIP_OFFER_TTL_DAYS = 7;

/**
 * Who may open Studio → Settings, and how much of it they see.
 *
 * - `full` — admin or owner: the General form and the Ownership card.
 * - `ownership-only` — a creator who has an open ownership offer: the card
 *   only, so they can accept or decline (mockup state 6). This is the ONLY
 *   widening; a creator without an offer is still sent back to `/studio`.
 * - `none` — everyone else.
 * - `undefined` — the role is not known yet. The studio is `ssr = false`, so
 *   the first client render has no `userRole`; redirecting then would bounce
 *   authorised users.
 */
export type SettingsAccess = 'full' | 'ownership-only' | 'none';

export function settingsAccess(
  role: string | null | undefined,
  pendingOffer: PendingOwnershipOffer | null | undefined
): SettingsAccess | undefined {
  if (role === undefined) return undefined;
  if (role === 'owner' || role === 'admin') return 'full';
  if (role === 'creator' && pendingOffer) return 'ownership-only';
  return 'none';
}

/**
 * Which face of the card a view calls for.
 *
 * `openOffer` is only sent to the owner and to the offer's recipient, so a
 * non-owner who receives one IS the recipient — the view needs no viewer id.
 * `offer-closed` is a creator who reached Settings through an offer that has
 * since closed (it expired, or the owner withdrew it, after the layout loaded).
 */
export type OwnershipCardMode =
  | 'owner'
  | 'recipient'
  | 'readonly'
  | 'offer-closed';

export function ownershipCardMode(view: OwnershipView): OwnershipCardMode {
  if (view.viewerRole === 'owner') return 'owner';
  if (view.openOffer) return 'recipient';
  if (view.viewerRole === 'admin') return 'readonly';
  return 'offer-closed';
}

/**
 * Which state 9 note an owner's last closed offer earns, if any.
 *
 * `accepted` earns none (the owner summary already says who owns it, since
 * when), and neither does the owner cancelling their own offer: the mockup
 * shows notes only for outcomes the owner did not cause.
 *
 * Nor does a `support_reassigned` withdrawal. `lastOutcome` covers only offers
 * the CURRENT owner made (contract amended 2026-10-14), and a reassignment
 * withdraws the offer of the owner it removes — so the new owner never sees it,
 * and an offerer who later became owner again would be told someone else "is
 * now the owner". The previous owner seeing no note is accepted for now.
 */
export type OutcomeNote = 'declined' | 'expired' | 'ineligible';

export function outcomeNote(
  outcome: OwnershipLastOutcome | null | undefined
): OutcomeNote | null {
  if (!outcome) return null;
  switch (outcome.status) {
    case 'declined':
      return 'declined';
    case 'expired':
      return 'expired';
    case 'withdrawn':
      return outcome.withdrawnReason === 'recipient_ineligible'
        ? 'ineligible'
        : null;
    default:
      return null;
  }
}

/**
 * The type-the-name check (state 3, variant A). Same rule as the server —
 * trimmed, case-insensitive — so Send enables exactly when the server would
 * accept. A mismatch the server still reports means the organisation was
 * renamed since the page loaded.
 */
export function confirmNameMatches(typed: string, orgName: string): boolean {
  const expected = orgName.trim().toLowerCase();
  return expected.length > 0 && typed.trim().toLowerCase() === expected;
}

/** Basis points as a percentage: 6000 → "60%", 6250 → "62.5%". */
export function formatShareBps(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

/**
 * When an offer sent now would expire. Display only — the server stamps the
 * real `expires_at`, and the pending card shows that one once it exists.
 */
export function estimatedOfferExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + OWNERSHIP_OFFER_TTL_DAYS * 86_400_000);
}

/**
 * Whether an offer the layout loaded is still open by the clock. Expiry is
 * lazy server-side (no cron), so a banner loaded before the deadline would
 * otherwise keep inviting a response the server will refuse.
 */
export function isOfferLive(
  expiresAt: string,
  now: number = Date.now()
): boolean {
  const deadline = Date.parse(expiresAt);
  return Number.isFinite(deadline) && deadline > now;
}
