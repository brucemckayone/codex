/**
 * Unit semantics (load-bearing for WP-4 payout pipeline):
 *
 * `proposed_creator_share_percent` is the creator's slice of the
 * POST-PLATFORM pool, in basis points (0-10000). This matches the
 * schema column comment in `ecommerce.ts` and the legacy
 * `calculateRevenueSplit` in @codex/purchase, which treats
 * `organization_fee_percentage` as a fraction of (gross - platform_fee).
 *
 * Therefore: dual-write `organization_fee_percentage = 10000 - share`
 * (both quantities in the same post-platform unit), and validation
 * checks `sum(active creator shares) <= 10000` — the platform fee is
 * already accounted for upstream of this pool and does NOT enter share
 * validation.
 */

/**
 * @codex/agreements — Share validation math
 *
 * Pure functions, no DB access. Used by `AgreementService` at propose-time
 * and re-checked at accept-time. Lives in its own module so the math can
 * be unit-tested without a database fixture and so the worker can re-use
 * the same predicate at API boundary (e.g. POST /agreements/preview).
 *
 * Units: all percentages are basis points (0–10000) of the post-platform
 * pool, matching the `proposed_creator_share_percent` and
 * `organization_fee_percentage` columns. NEVER pass floats here.
 */

import { ShareExceedsAvailableError } from '../errors';

/**
 * Bounds for a single basis-point percentage value.
 *
 * Mirrors the `check_agreement_proposals_share_bps` and
 * `check_org_fee_percentage` constraints. We validate locally so the
 * service throws a domain error instead of letting Postgres throw a
 * less-actionable constraint violation.
 */
const BPS_MIN = 0;
const BPS_MAX = 10_000;

/**
 * Slim view of an agreement row that `sumActiveCreatorShares` cares about.
 *
 * Anything carrying `sharePercent` and a `status` we can narrow to
 * `'active'` works — keeps callers from having to pluck and rename
 * fields off the Drizzle row.
 */
export interface ActiveAgreementShareView {
  sharePercent: number;
  status: string;
}

/**
 * Sum the creator-share basis points across the supplied agreements that
 * are currently `status='active'`. Non-active rows are ignored — they
 * are kept in the table for audit (terminated / expired) but contribute
 * nothing to the live pool.
 *
 * @returns Total basis points (sum of all `sharePercent` where status='active').
 */
export function sumActiveCreatorShares(
  agreements: readonly ActiveAgreementShareView[]
): number {
  let total = 0;
  for (const a of agreements) {
    if (a.status === 'active') {
      total += a.sharePercent;
    }
  }
  return total;
}

/**
 * Inputs to `validateProposedShare` — names mirror the math, not any
 * specific DB column, so callers can re-use the function in any
 * context (propose, counter, accept, preview API).
 *
 * Platform fee is deliberately NOT a parameter — see the file header.
 * The post-platform pool is the only unit this function reasons about.
 */
export interface ValidateProposedShareInput {
  /** Basis points the new proposal would lock in. */
  proposedSharePercent: number;
  /**
   * Basis-point shares from *other* currently-active agreements on the
   * same (org, revenue_type) bucket. The caller filters out any
   * agreement being replaced/superseded by this proposal — passing the
   * full active set without that filter would double-count.
   */
  existingActiveShares: readonly number[];
}

/**
 * Throws `ShareExceedsAvailableError` when the proposed creator share
 * would overflow the post-platform pool. The remaining pool is
 *
 *   10000 - sum(existingActiveShares)
 *
 * The boundary is inclusive — a proposal that exactly fills the
 * remaining pool is accepted (the org owner residual goes to zero,
 * which is a legal outcome).
 *
 * Also enforces that the proposed share is within the basis-point range
 * [0, 10000]. We surface this as the same domain error so the API
 * caller doesn't have to discriminate between "out of range" and
 * "exceeds remaining pool" — they're both "fix the slider" at the UI.
 *
 * Pure function, no DB access. Safe to call inside transactions.
 */
export function validateProposedShare(input: ValidateProposedShareInput): void {
  const { proposedSharePercent, existingActiveShares } = input;

  // Per-field bounds. Doing it here rather than relying solely on the DB
  // CHECK gives the API a 422 with a meaningful message before a write.
  if (
    !Number.isInteger(proposedSharePercent) ||
    proposedSharePercent < BPS_MIN ||
    proposedSharePercent > BPS_MAX
  ) {
    throw new ShareExceedsAvailableError(
      'Proposed creator share must be an integer basis-point value between 0 and 10000',
      { proposedSharePercent }
    );
  }

  // Validate each existing share is within bounds — if a caller passes a
  // negative or out-of-range value here, we want a meaningful error, not
  // a silent arithmetic skew.
  for (const n of existingActiveShares) {
    if (!Number.isInteger(n) || n < BPS_MIN || n > BPS_MAX) {
      throw new ShareExceedsAvailableError(
        'Existing active share basis-points must each be integers between 0 and 10000',
        { existingActiveSharePercent: n }
      );
    }
  }

  const existingSum = existingActiveShares.reduce((acc, n) => acc + n, 0);
  const maxAllowed = BPS_MAX - existingSum;

  if (proposedSharePercent > maxAllowed) {
    throw new ShareExceedsAvailableError(
      'Proposed creator share would exceed the available pool',
      {
        proposedSharePercent,
        existingActiveSharePercent: existingSum,
        maxAllowedSharePercent: Math.max(0, maxAllowed),
      }
    );
  }
}

/**
 * Convenience: the dual-write invariant from WP-1 discoveries.
 *
 *   organization_fee_percentage = 10000 - proposed_creator_share_percent
 *
 * Keeps the legacy payout pipeline happy until WP-4 swaps the read path.
 * Centralising the formula here means every writer in `AgreementService`
 * uses the same expression and a future grep finds them all.
 */
export function legacyOrgFeeFromCreatorShare(
  creatorSharePercent: number
): number {
  return BPS_MAX - creatorSharePercent;
}

/**
 * Inverse of {@link legacyOrgFeeFromCreatorShare}: derive a creator's
 * post-platform share from the legacy `organization_fee_percentage`
 * column. Same arithmetic (10000 - x is its own inverse) but the
 * function name documents the direction at the call site — important
 * for WP-4 when the read path swaps off the legacy column entirely.
 */
export function creatorShareFromLegacyOrgFee(orgFeePercent: number): number {
  return BPS_MAX - orgFeePercent;
}

/**
 * Canonical human-readable label for a {@link RevenueType}. Centralised so
 * email templates (AgreementService), the studio UI (AgreementCard,
 * NegotiationThread, ProposeAgreementDialog) and any future surface use
 * the same string — "content-purchase" (hyphen) matches the enum value
 * exactly and reads consistently across the product. English-only for
 * now; i18n is a future scope (WP-5 brief).
 *
 * Exhaustive `switch` with a `never` assertion (Codex-0omga polish):
 * if a future migration adds a third revenue type and we forget to
 * extend this mapper, the `_exhaustive: never` line is a compile
 * error rather than a silent "content-purchase" fallback that could
 * mislabel the share in a customer-facing email.
 */
export function formatRevenueTypeLabel(
  revenueType: 'subscription' | 'content_purchase'
): string {
  switch (revenueType) {
    case 'subscription':
      return 'subscription';
    case 'content_purchase':
      return 'content-purchase';
    default: {
      const _exhaustive: never = revenueType;
      return _exhaustive;
    }
  }
}
