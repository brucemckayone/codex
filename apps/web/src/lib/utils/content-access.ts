/**
 * Content access-policy DISPLAY helpers (Codex-2pryk.2.2 · WP-1).
 *
 * WP-1 hard-replaced the single `content.accessType` enum with the separable
 * SPEC §6.1 policy flags (`isFree` / `isPurchasable` + `priceCents` /
 * `isTierGated` / `courseOnly` / `isFollowerGated` / `isTeamOnly`). Access
 * DECISIONS now read those flags directly (server `@codex/access`, client
 * `access-context` / `subscription-context`).
 *
 * This module covers the DISPLAY concern, and its write-boundary inverse
 * ({@link accessGroupToFlags}, which the studio's Publish step saves
 * through, Codex-a6ofh.2.4): badges, meta chips, and the
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
 * and the narrower landing-page / section item shapes satisfy it without a cast.
 * (Deliberately not naming callers: the two it used to name, AudioWall and
 * ArticleEditorial, were deleted with the landing redesign.)
 */
export interface ContentAccessPolicyLike {
  isFree?: boolean | null;
  isPurchasable?: boolean | null;
  priceCents?: number | null;
  /**
   * The subscribers-only switch (Codex-2hxff.91). Which plans open it is the
   * item's `includedInTierIds`; on with none ticked is CLOSED, never free.
   */
  isTierGated?: boolean | null;
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
 * `isTierGated`: a hybrid "purchasable + tier-included" item resolves to
 * `'paid'` (its former `accessType`) and the caller passes the plan label
 * separately, so `PriceBadge` renders the stacked price/plan badge. This is
 * the DISPLAY inverse — the `@codex/access` gate orders tier before paid, a
 * decision concern that does not affect the label.
 *
 * The switch is read, never the set: a gated item with no plan ticked is
 * `'subscribers'` (closed), never `'free'`, and the Studio editor opens it as
 * subscribers-only (Codex-2hxff.91).
 */
export function deriveContentAccessKind(
  policy: ContentAccessPolicyLike
): ContentAccessKind {
  if (policy.isTeamOnly) return 'team';
  if (policy.isFollowerGated) return 'followers';
  if (policy.isPurchasable || (policy.priceCents ?? 0) > 0) return 'paid';
  if (policy.isTierGated === true) return 'subscribers';
  return 'free';
}

/**
 * Translate the studio access editor's choice (its one kind, the price and
 * the tiers ticked) into the SPEC §6.1 policy flags the content API expects.
 * The write-boundary inverse of `deriveContentAccessKind`.
 *
 * Plan access (Codex-2hxff.91): `isTierGated` is the subscribers-only switch
 * and `includedInTierIds` the exact set of tiers. Gated with no tier is
 * CLOSED (only buyers, granted users and the team get in), never free, so an
 * empty set is a legal save: the editor shows the "Closed to subscribers"
 * warning instead of refusing (owner decision U2).
 *
 * The choice is held as one group (the editor's `DraftAccess`,
 * Codex-a6ofh.2.4). Its `tierIds` is `null` when the plans were never read
 * (untouched this session, or the tier list failed to load): the set is then
 * left out of the payload and the server keeps the ticks. For a paid item the
 * switch follows the set, so it is left out too: guessing it would either
 * clear real ticks (`false`) or gate an item the creator never put in a tier
 * (`true`). The new web never sends the legacy `includedInTierId`: the
 * schema refuses it beside the new fields.
 *
 * Orgless (personal) content has no tiers; the picker never renders for it.
 * A subscribers selection there still sends the switch, which the server
 * refuses ("orgless content cannot be tier-gated"): refused, never free.
 */
export function accessGroupToFlags(
  access: {
    kind: ContentAccessKind;
    priceCents: number;
    tierIds: string[] | null;
  },
  organizationId: string | null | undefined
): {
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  isTierGated?: boolean;
  includedInTierIds?: string[];
  isFollowerGated: boolean;
  isTeamOnly: boolean;
} {
  const { priceCents } = access;
  const ids = organizationId ? (access.tierIds ?? undefined) : undefined;
  switch (access.kind) {
    case 'paid':
      // Purchasable; may also be included in tiers (hybrid). In no tier it is
      // simply for sale, not closed.
      return {
        isFree: false,
        isPurchasable: true,
        priceCents,
        ...(ids === undefined
          ? {}
          : ids.length > 0
            ? { isTierGated: true, includedInTierIds: ids }
            : { isTierGated: false }),
        isFollowerGated: false,
        isTeamOnly: false,
      };
    case 'subscribers':
      // The subscribers-only switch. The optional price makes it ALSO
      // purchasable (only with a real price, so pure subscription content
      // keeps its 'subscribers' display kind).
      return {
        isFree: false,
        isPurchasable: priceCents > 0,
        priceCents: priceCents > 0 ? priceCents : null,
        isTierGated: true,
        ...(ids === undefined ? {} : { includedInTierIds: ids }),
        isFollowerGated: false,
        isTeamOnly: false,
      };
    // Every other kind turns the switch off; the server then clears the ticks
    // in the same transaction, so no set is sent.
    case 'followers':
      return {
        isFree: false,
        isPurchasable: false,
        priceCents: null,
        isTierGated: false,
        isFollowerGated: true,
        isTeamOnly: false,
      };
    case 'team':
      return {
        isFree: false,
        isPurchasable: false,
        priceCents: null,
        isTierGated: false,
        isFollowerGated: false,
        isTeamOnly: true,
      };
    default:
      return {
        isFree: true,
        isPurchasable: false,
        priceCents: null,
        isTierGated: false,
        isFollowerGated: false,
        isTeamOnly: false,
      };
  }
}
