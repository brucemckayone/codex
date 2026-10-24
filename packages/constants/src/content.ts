import { PRICE_LIMITS } from './commerce';
/**
 * Content domain constants
 */

export const CONTENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
} as const;

export const MEDIA_STATUS = {
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  TRANSCODING: 'transcoding',
  READY: 'ready',
  FAILED: 'failed',
} as const;

export const CONTENT_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
  WRITTEN: 'written',
} as const;

export const MEDIA_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
} as const;

export const VISIBILITY = {
  PUBLIC: 'public',
  PRIVATE: 'private',
  MEMBERS_ONLY: 'members_only',
  PURCHASED_ONLY: 'purchased_only',
} as const;

/**
 * Content access KIND — a single, mutually-exclusive DISPLAY/INPUT label for how
 * content is gated (free / paid / subscribers / followers / team / course).
 *
 * NOT a stored column. The former `content.access_type` enum was HARD-REPLACED
 * by the separable {@link ContentAccessFlags} policy (SPEC §6.1 — `is_free`,
 * `is_purchasable`, `included_in_tier_id`, `course_only`, `is_follower_gated`,
 * `is_team_only`). This projection exists only so the studio form (an exclusive
 * picker) and display badges can keep speaking in one "kind":
 *   - {@link deriveContentAccessKind} — flags → kind (display label / legacy
 *     behaviour-preservation). Precedence is most-specific-first.
 *   - {@link contentAccessKindToPolicy} — kind → flags (the form's write path).
 *
 * The authorization decision itself NEVER goes through this projection — the
 * entitlement resolver (`@codex/access`) reads the flags directly (SPEC §6.3).
 *
 * Legacy value mapping (HARDENING §H2): free→isFree, paid→isPurchasable,
 * subscribers→includedInTierId, followers→isFollowerGated, team→isTeamOnly.
 * `course` (courseOnly) is net-new. 'members' was a stale alias for 'team',
 * fully removed.
 *
 * @see ACCESS_TYPES for per-user grant records (how a user *obtained* access).
 */
export const CONTENT_ACCESS_TYPE = {
  FREE: 'free',
  PAID: 'paid',
  FOLLOWERS: 'followers',
  SUBSCRIBERS: 'subscribers',
  TEAM: 'team',
  COURSE: 'course',
} as const;

export type ContentAccessType =
  (typeof CONTENT_ACCESS_TYPE)[keyof typeof CONTENT_ACCESS_TYPE];

/**
 * The separable, non-exclusive content access policy (SPEC §6.1). Structural
 * subset of `@codex/shared-types` `ContentAccessPolicy` (kept local so this
 * foundation package carries no cross-package dependency; the shapes must stay
 * in sync). These are the columns stored on `content`.
 */
export interface ContentAccessFlags {
  isFree: boolean;
  isPurchasable: boolean;
  priceCents: number | null;
  includedInTierId: string | null;
  courseOnly: boolean;
  isFollowerGated: boolean;
  isTeamOnly: boolean;
}

/**
 * Project the flag policy down to a single display KIND (most-specific-first).
 * `courseOnly` wins (content lives only inside courses); then management-only;
 * then a one-off price (paid, incl. the paid+tier hybrid); then tier-inclusion;
 * then follower-gating; else free.
 */
export function deriveContentAccessKind(
  flags: Omit<ContentAccessFlags, 'priceCents'>
): ContentAccessType {
  if (flags.courseOnly) return CONTENT_ACCESS_TYPE.COURSE;
  if (flags.isTeamOnly) return CONTENT_ACCESS_TYPE.TEAM;
  if (flags.isPurchasable) return CONTENT_ACCESS_TYPE.PAID;
  if (flags.includedInTierId) return CONTENT_ACCESS_TYPE.SUBSCRIBERS;
  if (flags.isFollowerGated) return CONTENT_ACCESS_TYPE.FOLLOWERS;
  return CONTENT_ACCESS_TYPE.FREE;
}

/**
 * Expand an exclusive display KIND back into the stored flag policy. `priceCents`
 * is carried for `paid`; `includedInTierId` for `subscribers` and the `paid`
 * hybrid (paid content also included at a tier). Every other flag is cleared.
 */
export function contentAccessKindToPolicy(
  kind: ContentAccessType,
  opts: { priceCents?: number | null; includedInTierId?: string | null } = {}
): ContentAccessFlags {
  const priceCents = opts.priceCents ?? null;
  const tier = opts.includedInTierId ?? null;
  return {
    isFree: kind === CONTENT_ACCESS_TYPE.FREE,
    isPurchasable: kind === CONTENT_ACCESS_TYPE.PAID,
    priceCents: kind === CONTENT_ACCESS_TYPE.PAID ? priceCents : null,
    includedInTierId:
      kind === CONTENT_ACCESS_TYPE.SUBSCRIBERS ||
      kind === CONTENT_ACCESS_TYPE.PAID
        ? tier
        : null,
    courseOnly: kind === CONTENT_ACCESS_TYPE.COURSE,
    isFollowerGated: kind === CONTENT_ACCESS_TYPE.FOLLOWERS,
    isTeamOnly: kind === CONTENT_ACCESS_TYPE.TEAM,
  };
}

/**
 * Can a support grant (a `grant` entitlement) open this content? Only paid or
 * subscriber content: owner decision 2026-10-21, "only items it can open"
 * (Codex-2hxff.21). The admin grant writer refuses anything else, and the
 * Studio's grant pickers offer only these items.
 *
 * Mirrors the branch order of `decideContentAccess`
 * (`packages/access/src/services/content-access/access-decision.ts`):
 * courseOnly → team-only → followers-only → tier → paid → free. The first
 * three branches return before any entitlement is read, and free content is
 * open to everyone, so only the tier arm (`subscribers_entitlement`, :348) and
 * the paid arm (`paid_entitlement`, :364) read an entitlement. If that order
 * changes, change this too; `@codex/access` has a test that ties the two.
 */
export function isGrantableContent(
  c: Pick<
    ContentAccessFlags,
    | 'courseOnly'
    | 'isTeamOnly'
    | 'isFollowerGated'
    | 'includedInTierId'
    | 'priceCents'
  >
): boolean {
  return (
    !c.courseOnly &&
    !c.isTeamOnly &&
    !c.isFollowerGated &&
    (c.includedInTierId != null || (c.priceCents ?? 0) > 0)
  );
}

/**
 * Is this content offered for a one-off purchase that would actually open it?
 * Checkout refuses anything else, and the content page shows Buy only for
 * these items (owner decision, Codex-2hxff.14: "checkout only for items a
 * purchase opens").
 *
 * The seller must have marked it purchasable at a price of at least
 * `PRICE_LIMITS.MIN_CENTS`, and its access rule must honour a purchase.
 * `decideContentAccess` reads a purchase only in the tier arm
 * (`subscribers_purchase`) and the paid arm (`paid_purchase`): course-only,
 * team-only and followers-only content return before either, and orgless
 * content with a tier is denied to everyone (`orgless_tier_gate`). A test in
 * `@codex/access` ties the two, as it does for `isGrantableContent`.
 *
 * Lifecycle (published, not deleted) is not read here: checkout refuses those
 * with their own reasons.
 */
export function canBeSold(
  c: Pick<
    ContentAccessFlags,
    | 'isPurchasable'
    | 'priceCents'
    | 'courseOnly'
    | 'isTeamOnly'
    | 'isFollowerGated'
    | 'includedInTierId'
  > & { organizationId: string | null }
): boolean {
  return (
    c.isPurchasable &&
    (c.priceCents ?? 0) >= PRICE_LIMITS.MIN_CENTS &&
    !c.courseOnly &&
    !c.isTeamOnly &&
    !c.isFollowerGated &&
    !(c.organizationId == null && c.includedInTierId != null)
  );
}

/**
 * The policy fields publicness depends on. Every field is REQUIRED but nullable,
 * so a full content row or a public list item satisfies it without a cast, and
 * a projection that leaves a gate out fails to type-check. Optional fields
 * would read a missing gate as "no gate" and ship a gated body publicly (fail
 * open); `decideContentAccess`'s row type requires every gate for the same
 * reason.
 */
export interface ContentPublicnessPolicy {
  isFree: boolean | null;
  isPurchasable: boolean | null;
  priceCents: number | null;
  includedInTierId: string | null;
  isFollowerGated: boolean | null;
  isTeamOnly: boolean | null;
  courseOnly: boolean | null;
}

/**
 * Can anyone, signed in or not, read this content's body? The one rule for
 * where a body may go without an access check: the public content API returns
 * a body only for these rows (`ContentService.listPublic`), and the web's
 * detail pages render one unauthenticated only for these (Codex-039vo).
 *
 * It reads the WHOLE policy, not `isFree` alone (Codex-al9ft). `isFree` is a
 * derived flag that has disagreed with the gates: `ContentService.create` and
 * `update` once derived it from the flag gates and omitted `priceCents`, so a
 * price-only row came back free; and the course service sets `courseOnly` on
 * purpose while leaving `isFree` as it was, so a course-only practice can be
 * flagged free. Either way the access decision denies the row, so this
 * requires `isFree` AND no gate, and a row in the database with a divergent
 * shape still reads as not public. Fail closed on disagreement.
 *
 * Recognises the same six gates as `decideContentAccess`
 * (`packages/access/src/services/content-access/access-decision.ts`).
 */
export function isPublicContent(policy: ContentPublicnessPolicy): boolean {
  if (policy.isFree !== true) return false;
  return !(
    policy.isPurchasable === true ||
    (policy.priceCents ?? 0) > 0 ||
    policy.includedInTierId != null ||
    policy.isFollowerGated === true ||
    policy.isTeamOnly === true ||
    policy.courseOnly === true
  );
}

/**
 * Does publishing this content need the creator's payouts set up? Any price,
 * or inclusion in a tier, earns money, whether or not the item is marked
 * purchasable (owner decision, Codex-2hxff.14: "any priced item needs payouts
 * set up to publish"). The content publish and update paths and the admin
 * publish route all refuse with `CreatorPayoutsRequiredError` when this holds
 * and the creator can't be paid.
 */
export function requiresPayoutsToPublish(
  c: Pick<ContentAccessFlags, 'priceCents' | 'includedInTierId'>
): boolean {
  return (c.priceCents ?? 0) > 0 || c.includedInTierId != null;
}

/**
 * Content-access GRANT records — how a user *obtained* access to a piece of
 * content. One row per (user, content) in the `content_access` table
 * (`database/schema/ecommerce.ts`).
 *
 * Single source of truth for the `content_access.access_type` column: mirrors
 * its CHECK constraint (`database/schema/ecommerce.ts` `check_access_type`).
 *
 * - purchased:     one-time purchase (completed or pending-webhook)
 * - subscription:  granted via an active subscription
 * - complimentary: manually granted by an org admin (no charge)
 * - preview:       time-boxed / partial preview grant
 *
 * NB: distinct from CONTENT_ACCESS_TYPE, which gates the content itself
 * (`content.access_type`) rather than recording how a user got in.
 *
 * @see CONTENT_ACCESS_TYPE for the content-gating model.
 */
export const ACCESS_TYPES = {
  PURCHASED: 'purchased',
  SUBSCRIPTION: 'subscription',
  COMPLIMENTARY: 'complimentary',
  PREVIEW: 'preview',
} as const;

export type ContentAccessGrantType =
  (typeof ACCESS_TYPES)[keyof typeof ACCESS_TYPES];
