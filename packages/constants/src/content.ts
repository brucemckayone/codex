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
