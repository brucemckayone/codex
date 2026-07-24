/**
 * Content access-policy DISPLAY helpers (Codex-2pryk.2.2 · WP-1).
 *
 * WP-1 hard-replaced the single `content.accessType` enum with the separable
 * SPEC §6.1 policy flags (`isFree` / `isPurchasable` + `priceCents` /
 * `includedInTierId` / `courseOnly` / `isFollowerGated` / `isTeamOnly`). Access
 * DECISIONS now read those flags directly (server `@codex/access`, client
 * `access-context` / `subscription-context`).
 *
 * This module covers only the DISPLAY concern: badges, meta chips, and the
 * `contentAccessType` prop forwarded to `PriceBadge` want ONE exclusive label,
 * not the flag set. {@link deriveContentAccessKind} collapses the flags back to
 * that single kind so the presentation components keep their existing
 * kind-based rendering unchanged.
 *
 * This is a UI label ONLY — never a gate. It is intentionally NOT the
 * `contentAccess` GRANT enum (`purchased` / `membership` / `subscription`,
 * `ACCESS_TYPES` in `@codex/constants`), which describes how a user OBTAINED
 * access and is a different domain left untouched by WP-1.
 */

/**
 * The exclusive display label for content's access policy — the successor of
 * the former `content.accessType` enum, kept only for presentation.
 */
export type ContentAccessKind =
  | 'free'
  | 'paid'
  | 'followers'
  | 'subscribers'
  | 'team';

/**
 * Structural subset of the SPEC §6.1 policy flags read by the display helpers.
 * Every field is optional/nullable so both the full `ContentWithRelations` row
 * and the narrower landing-page item shapes (AudioWall/ArticleEditorial) satisfy
 * it without a cast.
 */
export interface ContentAccessPolicyLike {
  isFree?: boolean | null;
  isPurchasable?: boolean | null;
  priceCents?: number | null;
  includedInTierId?: string | null;
  isFollowerGated?: boolean | null;
  isTeamOnly?: boolean | null;
}

/**
 * Collapse the policy flags to the single exclusive display kind, reproducing
 * the value the old `content.accessType` column carried for migrated data.
 *
 * Precedence — team > followers > paid > tier(subscribers) > free. This is the
 * behaviour-preserving inverse of the legacy CHECK mapping (HARDENING §H2):
 * migrated single-mode rows set exactly one gate, so the order is only
 * observable for future multi-flag content. Note that `paid` is checked BEFORE
 * `includedInTierId`: a hybrid "purchasable + tier-included" item resolves to
 * `'paid'` (its former `accessType`) and the caller passes the tier name
 * separately, so `PriceBadge` renders the stacked price/tier badge. This is
 * the DISPLAY inverse — the `@codex/access` gate orders tier before paid, a
 * decision concern that does not affect the label.
 */
export function deriveContentAccessKind(
  policy: ContentAccessPolicyLike
): ContentAccessKind {
  if (policy.isTeamOnly) return 'team';
  if (policy.isFollowerGated) return 'followers';
  if (policy.isPurchasable || (policy.priceCents ?? 0) > 0) return 'paid';
  if (policy.includedInTierId != null) return 'subscribers';
  return 'free';
}
