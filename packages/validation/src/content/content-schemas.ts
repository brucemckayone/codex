import {
  CONTENT_ACCESS_TYPE,
  CONTENT_STATUS,
  CONTENT_TYPES,
  isReservedSubdomain,
  MEDIA_STATUS,
  MEDIA_TYPES,
  VISIBILITY,
} from '@codex/constants';
import { z } from 'zod';
import {
  createOptionalTextSchema,
  createSanitizedStringSchema,
  createSlugSchema,
  priceCentsSchema,
  urlSchema,
  userIdSchema,
  uuidSchema,
} from '../primitives';
import {
  PAGINATION_MAX_PAGE,
  paginationSchema,
} from '../shared/pagination-schema';
import {
  createSearchQuerySchema,
  hasNoNul,
  SEARCH_MAX_QUERY_LENGTH,
} from '../shared/search-schema';

/**
 * Content Management Validation Schemas
 *
 * Security-focused validation for organizations, media items, and content.
 * Aligned with database schema at packages/database/src/schema/content.ts
 *
 * Key Security Principles:
 * 1. XSS Prevention: Sanitize all user-generated strings
 * 2. Input Length Limits: Match database constraints exactly
 * 3. Enum Whitelisting: Only allow database-defined enum values
 * 4. Type Safety: Export inferred types for use across application
 * 5. Clear Error Messages: User-friendly, non-leaking error messages
 */

// ============================================================================
// Reusable Schema Components
// ============================================================================

/**
 * Content slug validation (max 500 chars)
 */
const slugSchema = createSlugSchema(500);

/**
 * Organization slug validation (max 255 chars)
 * Must be unique across platform and not conflict with reserved subdomains
 */
const organizationSlugSchema = createSlugSchema(255).refine(
  (slug) => !isReservedSubdomain(slug),
  { message: 'This slug is reserved and cannot be used for an organization' }
);

/**
 * Sanitized string for user-generated content
 * - Trims whitespace
 * - Prevents empty strings
 * - Use for titles, descriptions, names
 */
const sanitizedStringSchema = createSanitizedStringSchema;

/**
 * Optional sanitized text (can be null)
 */
const optionalTextSchema = createOptionalTextSchema;

// ============================================================================
// Organization Schemas
// ============================================================================

/**
 * Database enum: No CHECK constraint, but follows convention
 * Keeping validation for type safety
 */
export const organizationStatusEnum = z.enum([
  'active',
  'suspended',
  'deleted',
]);

/**
 * Create Organization Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 10-27
 */
export const createOrganizationSchema = z.object({
  name: sanitizedStringSchema(1, 255, 'Organization name'),
  slug: organizationSlugSchema,
  description: optionalTextSchema(5000, 'Description'),
  logoUrl: urlSchema.optional().nullable(),
  websiteUrl: urlSchema.optional().nullable(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * Update Organization Input
 * All fields optional (partial update)
 */
export const updateOrganizationSchema = createOrganizationSchema.partial();

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ============================================================================
// Media Item Schemas
// ============================================================================

/**
 * Media type enum
 * Aligns with database CHECK constraint: line 73
 */
export const mediaTypeEnum = z.enum([MEDIA_TYPES.VIDEO, MEDIA_TYPES.AUDIO]);

/**
 * Media status enum
 * Aligns with database CHECK constraint: line 72
 */
export const mediaStatusEnum = z.enum([
  MEDIA_STATUS.UPLOADING,
  MEDIA_STATUS.UPLOADED,
  MEDIA_STATUS.TRANSCODING,
  MEDIA_STATUS.READY,
  MEDIA_STATUS.FAILED,
]);

/**
 * MIME type validation for media uploads
 * Whitelist only supported formats
 */
const mimeTypeSchema = z.enum([
  // Video formats
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  // Audio formats
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
]);

/**
 * Create Media Item Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 35-74
 */
export const createMediaItemSchema = z.object({
  title: sanitizedStringSchema(1, 255, 'Media title'),
  description: optionalTextSchema(5000, 'Description'),
  mediaType: mediaTypeEnum,
  mimeType: mimeTypeSchema,
  fileSizeBytes: z
    .number()
    .int('File size must be a whole number')
    .min(1, 'File size must be greater than 0')
    .max(5 * 1024 * 1024 * 1024, 'File size cannot exceed 5GB'), // 5GB max

  // R2 storage path — optional, generated server-side if not provided.
  // When provided (e.g. tests), validated to prevent path traversal here, and
  // MediaItemService.create refuses any key outside the caller's own
  // `{creatorId}/originals/` folder (Codex-58h6c).
  r2Key: z
    .string()
    .min(1, 'R2 key cannot be empty')
    .max(500, 'R2 key must be 500 characters or less')
    .regex(
      /^[a-zA-Z0-9/_-]+(\.[a-zA-Z0-9]+)?$/,
      'R2 key contains invalid characters'
    )
    .refine(
      (key) => !key.includes('..'),
      'R2 key cannot contain path traversal sequences'
    )
    .optional(),
});

export type CreateMediaItemInput = z.infer<typeof createMediaItemSchema>;

/**
 * Update Media Item Input: what a creator may edit (PATCH /api/media/:id).
 *
 * Strict, so a body naming anything else is refused, not quietly trimmed.
 * Status, keys and dimensions are written only by the upload and transcoding
 * paths (Codex-l2c48.9): a creator setting `status: 'ready'` skipped the
 * transcode, and the live status object never heard of the change.
 */
export const updateMediaItemSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
  })
  .strict();

export type UpdateMediaItemInput = z.infer<typeof updateMediaItemSchema>;

/**
 * Body of `POST /api/media/:id/upload-complete`.
 *
 * Carries the CLIENT's own `loadedmetadata` measurement of the file it just
 * uploaded. `media_items.duration_seconds` is otherwise written only by the
 * RunPod completion webhook (TranscodingService), so the column stayed NULL
 * for the minutes between a creator finishing an upload and transcoding
 * completing — which is exactly when they are building the page that shows the
 * runtime badge.
 *
 * `.catch({})` IS THE RISK POSTURE, not laziness. A runtime badge is advisory
 * display copy, so a malformed, absent or hostile body must degrade to "no
 * duration" and let the upload complete. A 400 here would lose the creator's
 * file after its bytes are already in R2.
 *
 * `min(1)`: a zero-length runtime is not a runtime. Storing 0 paints a
 * `0:00` badge, which is a lie, where NULL correctly paints nothing.
 */
export const uploadCompleteSchema = z
  .object({
    durationSeconds: z.number().int().min(1).max(86400).optional(),
  })
  .catch({});

export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema>;

// ============================================================================
// Content Schemas
// ============================================================================

/**
 * Content type enum
 * Aligns with database CHECK constraint: line 150
 */
export const contentTypeEnum = z.enum([
  CONTENT_TYPES.VIDEO,
  CONTENT_TYPES.AUDIO,
  CONTENT_TYPES.WRITTEN,
]);

/**
 * Visibility enum
 * Aligns with database CHECK constraint: line 149
 */
export const visibilityEnum = z.enum([
  VISIBILITY.PUBLIC,
  VISIBILITY.PRIVATE,
  VISIBILITY.MEMBERS_ONLY,
  VISIBILITY.PURCHASED_ONLY,
]);

/**
 * Content access KIND enum — the exclusive DISPLAY/FILTER projection of the
 * flag policy (SPEC §6.1). Used for the studio access picker and the content
 * list `accessType` filter, NOT for the stored columns (those are the flags on
 * `baseContentSchema`). See `CONTENT_ACCESS_TYPE` (@codex/constants).
 */
export const contentAccessTypeEnum = z.enum([
  CONTENT_ACCESS_TYPE.FREE,
  CONTENT_ACCESS_TYPE.PAID,
  CONTENT_ACCESS_TYPE.FOLLOWERS,
  CONTENT_ACCESS_TYPE.SUBSCRIBERS,
  CONTENT_ACCESS_TYPE.TEAM,
  CONTENT_ACCESS_TYPE.COURSE,
]);

/**
 * Content status enum
 * Aligns with database CHECK constraint: line 148
 */
export const contentStatusEnum = z.enum([
  CONTENT_STATUS.DRAFT,
  CONTENT_STATUS.PUBLISHED,
  CONTENT_STATUS.ARCHIVED,
]);

/**
 * Tag validation
 * - Individual tag must be non-empty string
 * - Max 50 characters per tag
 * - Array max 20 tags
 */
const tagsArraySchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Tag cannot be empty')
      .max(50, 'Tag must be 50 characters or less')
  )
  .max(20, 'Maximum 20 tags allowed');

/**
 * Tags for a CREATE, where an absent value legitimately means "no tags".
 *
 * The `.default([])` is what makes this create-only (Codex-moyu5). `.partial()`
 * does NOT strip an inner default — a `ZodOptional<ZodDefault<…>>` still fills
 * the key in when the input omits it — so on an update schema this turns "the
 * caller did not mention tags" into "the caller sent an empty array", which is
 * indistinguishable from a deliberate clear. `updateContentSchema` therefore
 * overrides this field with {@link tagsArraySchema}; see the note there.
 */
const tagsSchema = tagsArraySchema.optional().default([]);

/**
 * A set of tier ids (Codex-2hxff.91), at most 50. A repeated id is refused
 * rather than collapsed: the service checks "every id is a live tier of this
 * org" by comparing the rows it finds with the ids it was sent, so a duplicate
 * would read as a missing tier.
 */
const tierIdSetSchema = (maxMessage: string) =>
  z
    .array(uuidSchema)
    .max(50, maxMessage)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'The same tier is listed twice',
    });

/**
 * Whether a payload gates the item behind tiers: the new switch, or the
 * phase-1 legacy single tier (`includedInTierId`), which the service expands
 * to the switch plus ladder ticks. `null` on the legacy field means "no tier".
 */
const statesTierGate = (data: {
  isTierGated?: boolean;
  includedInTierId?: string | null;
}): boolean => data.isTierGated === true || data.includedInTierId != null;

/** A gate the access decision applies BEFORE the tier arm (invariant I4). */
const hasExclusiveGate = (data: {
  isFollowerGated?: boolean;
  isTeamOnly?: boolean;
  courseOnly?: boolean;
}): boolean =>
  data.isFollowerGated === true ||
  data.isTeamOnly === true ||
  data.courseOnly === true;

/**
 * The legacy single tier stated beside the new switch or set. `undefined`
 * means "not stated"; an explicit `null` on the legacy field IS stated.
 */
const mixesLegacyTierInput = (data: {
  isTierGated?: boolean;
  includedInTierIds?: string[];
  includedInTierId?: string | null;
}): boolean =>
  data.includedInTierId !== undefined &&
  (data.isTierGated !== undefined || data.includedInTierIds !== undefined);

/**
 * Base content schema (without refinements)
 * Used for both create and update schemas
 */
const baseContentSchema = z.object({
  title: sanitizedStringSchema(1, 500, 'Title'),
  slug: slugSchema,
  description: optionalTextSchema(10000, 'Description'),
  contentType: contentTypeEnum,

  // Media reference (required for video/audio, optional for written)
  mediaItemId: uuidSchema.optional().nullable(),

  // Written content body (Phase 2+) — limit raised for Tiptap JSON overhead
  contentBody: optionalTextSchema(500000, 'Content body'),

  // Organization (nullable = personal content)
  organizationId: uuidSchema.optional().nullable(),

  // Category (simple string, Phase 1) — LEGACY. Superseded by `categoryIds`
  // (the `content_categories` taxonomy) as the source of truth. Left readable
  // this epic; dropped in a later cleanup once nothing writes it.
  category: z
    .string()
    .trim()
    .min(1, 'Category cannot be empty')
    .max(100, 'Category must be 100 characters or less')
    .optional()
    .nullable(),

  // Category taxonomy membership (WP-5) — the ids of `categories` this content
  // belongs to. Optional so it inherits into both create and update; absent on
  // update means "leave existing memberships untouched", an explicit array
  // (including []) REPLACES the set. ContentService verifies every id lives in
  // the content's OWN space (IDOR guard). Capped so a payload can't fan out an
  // unbounded join write.
  categoryIds: z.array(uuidSchema).max(20).optional(),

  // Tags (JSONB array)
  tags: tagsSchema,

  // Thumbnail (optional custom override)
  thumbnailUrl: urlSchema.optional().nullable(),

  // Access control POLICY (SPEC §6.1) — separable, non-exclusive flags that
  // replace the single `accessType`/`minimumTierId` conflation. Structural
  // mirror of `ContentAccessPolicy` (@codex/shared-types). All optional at the
  // input boundary; ContentService.create normalises unset flags (isFree → true,
  // the rest → false). The studio form builds these from an exclusive kind pick
  // via `contentAccessKindToPolicy` (@codex/constants).
  isFree: z.boolean().optional(),
  isPurchasable: z.boolean().optional(),

  priceCents: priceCentsSchema.optional(),

  // The subscribers-only switch (Codex-2hxff.91): the tier arm applies. The
  // GATE, kept apart from the SET below, so a gated item with no tier ticked
  // is CLOSED, never free. No `.default()` (see `includedInTierIds`).
  isTierGated: z.boolean().optional(),

  // The EXACT set of the org's tiers that include this item: a TOTAL set,
  // like `categoryIds` and `setCourseTierAccessSchema`. Absent = leave the
  // ticks alone; `[]` = in no tier (a gated item is then closed). NEVER give
  // this a `.default()`: `.partial()` does not strip an inner default
  // (Codex-moyu5), so every PATCH that never mentioned tiers would empty them.
  // ContentService checks every id is a live tier of the item's OWN org.
  includedInTierIds: tierIdSetSchema(
    'Cannot include one item in more than 50 tiers'
  ).optional(),

  // LEGACY (phase 1 of Codex-2hxff.91 only): the old studio's single "this
  // tier and above" pick. The service expands it to ladder ticks (every live
  // tier of the org at or above it, by sortOrder) and sets `isTierGated`.
  // Never sent together with `isTierGated` / `includedInTierIds`. Removed in
  // the cleanup release.
  includedInTierId: uuidSchema.optional().nullable(),

  // Reachable ONLY via a course entitlement (suppresses standalone paths).
  courseOnly: z.boolean().optional(),
  // Free to org followers / opt-in (was accessType 'followers').
  isFollowerGated: z.boolean().optional(),
  // Management/staff-only (was accessType 'team').
  isTeamOnly: z.boolean().optional(),

  // Shader preset for immersive audio playback mode
  shaderPreset: z
    .string()
    .trim()
    .max(50, 'Shader preset must be 50 characters or less')
    .optional()
    .nullable(),

  // Per-preset parameter overrides (intensity, grain, etc.)
  shaderConfig: z
    .record(z.string(), z.union([z.number(), z.boolean()]))
    .optional()
    .nullable(),

  // Creator-flagged "feature on homepage" — promotes to full-width editorial
  // card on the org landing feed. Defaults to false at DB level.
  featured: z.boolean().optional(),
});

/**
 * Create Content Input
 * Aligns with database schema: packages/database/src/schema/content.ts lines 81-152
 *
 * Security validations:
 * - Validates mediaItemId exists and belongs to creator (service layer)
 * - Validates content type matches media type (service layer)
 * - Slug uniqueness per organization (database constraint)
 */
export const createContentSchema = baseContentSchema
  .refine(
    (data) => {
      // Video/audio content MUST have mediaItemId
      if (
        ([CONTENT_TYPES.VIDEO, CONTENT_TYPES.AUDIO] as string[]).includes(
          data.contentType
        )
      ) {
        return !!data.mediaItemId;
      }
      return true;
    },
    {
      message: 'Media item is required for video and audio content',
      path: ['mediaItemId'],
    }
  )
  .refine(
    (data) => {
      // Written content MUST have contentBody
      if (data.contentType === CONTENT_TYPES.WRITTEN) {
        return !!data.contentBody && data.contentBody.length > 0;
      }
      return true;
    },
    {
      message: 'Content body is required for written content',
      path: ['contentBody'],
    }
  )
  .refine(
    (data) => {
      // Purchasable content requires a price (SPEC §6.1 — priceCents pairs
      // with isPurchasable). `priceCentsSchema` already refuses 1p–99p, so any
      // positive price that reaches here is at least £1.00.
      if (data.isPurchasable) {
        return !!data.priceCents && data.priceCents > 0;
      }
      return true;
    },
    {
      message: 'Purchasable content requires a price of at least £1.00',
      path: ['priceCents'],
    }
  )
  .refine(
    (data) => {
      // Follower-gated content requires an organisation (followers are org-scoped).
      if (data.isFollowerGated) {
        return !!data.organizationId;
      }
      return true;
    },
    {
      message: 'Followers-only content requires an organisation',
      path: ['organizationId'],
    }
  )
  .refine(
    (data) => {
      // Team-only content requires an organisation (org management roles).
      if (data.isTeamOnly) {
        return !!data.organizationId;
      }
      return true;
    },
    {
      message: 'Team-only content requires an organisation',
      path: ['organizationId'],
    }
  )
  .refine(
    (data) => {
      // Codex-up7bx: `subscription_tiers` is org-scoped (FK to organizations,
      // unique per org), so the tier gate is only meaningful on content that
      // belongs to an organization. Orgless (creator-direct) content behind a
      // tier is a semantically invalid row — there is no org against which a
      // subscription/tier could be resolved — and the access layer must fail
      // closed on it. Reject the combination at the write boundary so such a
      // row is never created in the first place (Codex-2hxff.91 refine (a):
      // the switch and the legacy single tier both count).
      return !statesTierGate(data) || !!data.organizationId;
    },
    {
      message:
        'Subscription tier requires an organisation — orgless content cannot be tier-gated',
      path: ['isTierGated'],
    }
  )
  .refine(
    (data) => {
      // Codex-2hxff.91 refine (b): ticks only mean something behind the gate.
      // On create there is no existing row, so an absent switch is OFF: a
      // non-empty set without `isTierGated: true` would be silently dropped.
      if (!data.includedInTierIds?.length) return true;
      return data.isTierGated === true;
    },
    {
      message:
        'Tiers can only be ticked on subscriber content — set isTierGated to include it in tiers',
      path: ['includedInTierIds'],
    }
  )
  .refine((data) => !statesTierGate(data) || !hasExclusiveGate(data), {
    // Codex-2hxff.91 refine (c), invariant I4: followers, team-only and
    // course-only are decided BEFORE the tier arm, so ticks on such a row
    // would be dead (and the seed validator already forbids follower + tier).
    message:
      'Tier-gated content cannot also be followers-only, team-only or course-only',
    path: ['isTierGated'],
  })
  .refine((data) => !statesTierGate(data) || data.isFree !== true, {
    // Codex-2hxff.91 refine (d), invariant I2: an item in no tier is CLOSED,
    // so the gate must never sit beside `isFree: true` — `isPublicContent`
    // would render its body into the anonymous payload.
    message:
      'Tier-gated content cannot be free — an item in no tier is closed, not free.',
    path: ['isFree'],
  })
  .refine((data) => !mixesLegacyTierInput(data), {
    // Codex-2hxff.91 refine (f): one form only. The legacy single tier is the
    // old studio's; the new studio sends the switch and the set.
    message:
      'Send either includedInTierId (legacy) or isTierGated / includedInTierIds, not both',
    path: ['includedInTierId'],
  })
  .refine(
    (data) => {
      // A non-free row MUST declare at least one access gate. This WP hard-
      // replaced the single `accessType` enum with separable flags and, in
      // doing so, dropped the old "subscribers requires a tier" guard. Without
      // this invariant an all-gates-off row with `isFree:false` falls through
      // the resolver's team/follower/tier/paid arms to PUBLIC (a paywall
      // bypass). Codex-2hxff.91 refine (e): the subscribers-only SWITCH is a
      // gate on its own — gated with no tier ticked is a legal, CLOSED row.
      // Reject any explicitly non-free row that carries no gate at all.
      if (data.isFree !== false) return true;
      return (
        !!data.isPurchasable ||
        // A PRICE IS A GATE (Codex-al9ft). Omitting it here also made this
        // refinement REJECT a legitimately priced non-free row, while the
        // message below has always named price as a gate.
        (data.priceCents ?? 0) > 0 ||
        !!data.isFollowerGated ||
        !!data.isTeamOnly ||
        !!data.courseOnly ||
        statesTierGate(data)
      );
    },
    {
      message:
        'Non-free content must declare at least one access gate (price, tier, followers, team, or course).',
      path: ['isTierGated'],
    }
  )
  .refine(
    (data) => {
      // THE INVERSE INVARIANT (Codex-al9ft): a priced row may never be FREE.
      // `@codex/access`'s paid arm is `(priceCents ?? 0) > 0` and it never reads
      // `isFree`, so a row carrying both a price and `isFree:true` is DENIED by
      // the gate while apps/web's `isPublicContent(isFree)` renders the full
      // body into the anonymous SSR payload (the leak that bead documents).
      // Every other refinement in this chain is guarded by
      // `if (data.isPurchasable)` or `if (data.isFree !== false)`, so a
      // price-only payload tripped NONE of them and reached the DB.
      if ((data.priceCents ?? 0) <= 0) return true;
      return data.isFree !== true;
    },
    {
      message:
        'Priced content cannot be free — a price is an access gate, so isFree must not be true.',
      path: ['isFree'],
    }
  );

export type CreateContentInput = z.infer<typeof createContentSchema>;

/**
 * Update Content Input
 * All fields optional (partial update). Cross-field invariants are checked
 * only when both fields are present in the partial payload — the remaining
 * "did the admin leave a tier set when switching to an incompatible mode?"
 * case is handled defensively in ContentService.update() (see content-service.ts).
 */
export const updateContentSchema = baseContentSchema
  .partial()
  // Codex-moyu5: drop the `.default([])` that `tagsSchema` carries for create.
  //
  // `.partial()` makes a key optional but does NOT remove an inner default, so
  // `baseContentSchema.partial().parse({ title })` yielded `{ title, tags: [] }`
  // — key PRESENT, value empty. `ContentService.update()` spreads the validated
  // partial straight into `.set()`, so every PATCH that did not mention tags
  // silently wiped the tag array. Verified against zod 4.3.6, and `tags` was
  // the only field in `baseContentSchema` carrying a default.
  //
  // With the default gone the key is omitted entirely when absent, which is
  // what the spread in `update()` already assumes, so "did not mention tags"
  // once again means "leave them alone". An explicit `tags: []` still clears.
  .extend({ tags: tagsArraySchema.optional() })
  .refine(
    (data) => {
      // Codex-up7bx: reject an update that gates the item behind tiers while
      // simultaneously clearing the organisation (organizationId explicitly null
      // in the same payload). Tiers are org-scoped, so orgless content can never
      // be tier-gated. When organizationId is ABSENT the existing org value
      // stands and we can't reason here — ContentService.update() refuses the
      // "gated on an already-orgless row" case against the effective row.
      if (!statesTierGate(data)) return true;
      if (!('organizationId' in data)) return true;
      return data.organizationId != null;
    },
    {
      message:
        'Subscription tier requires an organisation — orgless content cannot be tier-gated',
      path: ['isTierGated'],
    }
  )
  .refine(
    (data) => {
      // Codex-2hxff.91 refine (b): a non-empty set needs the gate. An ABSENT
      // switch is fine on an update (the existing row's switch stands, and the
      // service checks the effective value); only an explicit OFF beside ticks
      // is a contradiction.
      if (!data.includedInTierIds?.length) return true;
      return data.isTierGated !== false;
    },
    {
      message:
        'Tiers can only be ticked on subscriber content — set isTierGated to include it in tiers',
      path: ['includedInTierIds'],
    }
  )
  .refine((data) => !statesTierGate(data) || !hasExclusiveGate(data), {
    // Codex-2hxff.91 refine (c), I4, where the payload states both sides;
    // the service checks the effective row for a partial that states one.
    message:
      'Tier-gated content cannot also be followers-only, team-only or course-only',
    path: ['isTierGated'],
  })
  .refine((data) => !statesTierGate(data) || data.isFree !== true, {
    // Codex-2hxff.91 refine (d), I2 — mirrors the create schema.
    message:
      'Tier-gated content cannot be free — an item in no tier is closed, not free.',
    path: ['isFree'],
  })
  .refine((data) => !mixesLegacyTierInput(data), {
    // Codex-2hxff.91 refine (f) — mirrors the create schema.
    message:
      'Send either includedInTierId (legacy) or isTierGated / includedInTierIds, not both',
    path: ['includedInTierId'],
  })
  .refine(
    (data) => {
      // If a caller marks content purchasable AND sends a price in the same
      // payload, the price must be positive. A price-only or flag-only partial
      // is validated defensively in ContentService.update().
      if (!data.isPurchasable) return true;
      if (data.priceCents === undefined) return true;
      return !!data.priceCents && data.priceCents > 0;
    },
    {
      message: 'Purchasable content requires a price of at least £1.00',
      path: ['priceCents'],
    }
  )
  .refine(
    (data) => {
      // Mirror of the create-schema invariant: an update that EXPLICITLY marks
      // the row non-free (`isFree:false`) must also carry at least one access
      // gate, otherwise it persists a zero-gate non-free row that resolves to
      // PUBLIC (the subscribers-without-tier bypass). A partial that does not
      // set `isFree:false` is unaffected (the existing row's policy stands).
      // The subscribers-only switch counts as a gate (Codex-2hxff.91 refine
      // (e)): gated with no tier ticked is the legal CLOSED state.
      if (data.isFree !== false) return true;
      return (
        !!data.isPurchasable ||
        // A PRICE IS A GATE (Codex-al9ft) — mirrors the create schema.
        (data.priceCents ?? 0) > 0 ||
        !!data.isFollowerGated ||
        !!data.isTeamOnly ||
        !!data.courseOnly ||
        statesTierGate(data)
      );
    },
    {
      message:
        'Non-free content must declare at least one access gate (price, tier, followers, team, or course).',
      path: ['isTierGated'],
    }
  )
  .refine(
    (data) => {
      // Mirror of the create-schema inverse invariant (Codex-al9ft): a priced
      // row may never be FREE. Only fires when the partial carries BOTH fields;
      // a price-only or flag-only partial is clamped defensively in
      // `ContentService.update()`'s `effHasGate`, which was itself blind to
      // `priceCents` and so rewrote correctly-gated rows to public.
      if ((data.priceCents ?? 0) <= 0) return true;
      return data.isFree !== true;
    },
    {
      message:
        'Priced content cannot be free — a price is an access gate, so isFree must not be true.',
      path: ['isFree'],
    }
  );

export type UpdateContentInput = z.infer<typeof updateContentSchema>;

/**
 * Publish Content Input
 * Simple schema for status change operations
 */
export const publishContentSchema = z.object({
  contentId: uuidSchema,
});

export type PublishContentInput = z.infer<typeof publishContentSchema>;

// ============================================================================
// Query Parameter Schemas
// ============================================================================

/**
 * Pagination Input Type
 * Import from '@codex/validation' to use PaginationInput
 */

/**
 * Sort order enum
 */
export const sortOrderEnum = z.enum(['asc', 'desc']);

/** The longest topic (category) slug: the `categories.slug` column width. */
export const TOPIC_SLUG_MAX = 120;

/**
 * Content query/filter schema
 * Used for listing and searching content
 * Extends pagination with content-specific filters and sorting
 */
export const contentQuerySchema = paginationSchema.extend({
  // Filters
  status: contentStatusEnum.optional(),
  contentType: contentTypeEnum.optional(),
  accessType: contentAccessTypeEnum.optional(),
  // Up to the topic slug width, so a topic the public list accepts is accepted
  // here too (100 refused a real 101-120 character slug on /explore's
  // signed-in sorts). A NUL is refused: Postgres refuses NUL in text.
  category: z
    .string()
    .max(TOPIC_SLUG_MAX)
    .refine(hasNoNul, 'Category must not contain NUL')
    .optional(),
  organizationId: uuidSchema.optional(),
  // A user id (BetterAuth text), not a uuid: uuidSchema refused every real
  // one, so /explore's creator filter 400'd (Codex-osuqt).
  creatorId: userIdSchema.optional(),

  // Search
  search: createSearchQuerySchema(SEARCH_MAX_QUERY_LENGTH),

  // Sorting
  sortBy: z
    .enum([
      'createdAt',
      'updatedAt',
      'publishedAt',
      'title',
      'viewCount',
      'purchaseCount',
    ])
    .default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});

export type ContentQueryInput = z.infer<typeof contentQuerySchema>;

/**
 * Stricter sibling of `contentQuerySchema` for browse-style flows
 * (e.g. authenticated /explore "popular" / "top-selling" sorts).
 *
 * Browse queries cross creator boundaries — the result list contains
 * content from many creators within a single org. To prevent cross-org
 * data leakage, `organizationId` MUST be present. The looser
 * `contentQuerySchema` is reserved for studio-style queries where the
 * caller is browsing their OWN content (creator dashboards, drafts).
 *
 * Codex-q3zuf-style multi-tenant boundary protection.
 */
export const contentBrowseQuerySchema = contentQuerySchema.refine(
  (q) => q.organizationId !== undefined,
  {
    message: 'organizationId is required for cross-creator browsing',
    path: ['organizationId'],
  }
);

export type ContentBrowseQueryInput = z.infer<typeof contentBrowseQuerySchema>;

/**
 * Media item query schema
 * Extends pagination with media-specific filters and sorting
 */
export const mediaQuerySchema = paginationSchema.extend({
  status: mediaStatusEnum.optional(),
  mediaType: mediaTypeEnum.optional(),
  sortBy: z.enum(['createdAt', 'uploadedAt', 'title']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});

export type MediaQueryInput = z.infer<typeof mediaQuerySchema>;

/**
 * The usage fingerprint `GET /api/media/:id/usage` returns (Codex-6sbn1).
 * Opaque to the client: the delete sends it back, and a value the server
 * never issued simply doesn't match (409 `MEDIA_USAGE_CHANGED`), so this
 * bounds its shape and size only.
 */
export const mediaUsageFingerprintSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid usage fingerprint');

/**
 * `DELETE /api/media/:id?usage=<fingerprint>`. Optional: with nothing using
 * the item, a delete without one goes through, so an API caller that never
 * asked is not broken. With drafts using it, a missing or stale one is
 * refused.
 */
export const deleteMediaQuerySchema = z.object({
  usage: mediaUsageFingerprintSchema.optional(),
});

export type DeleteMediaQueryInput = z.infer<typeof deleteMediaQuerySchema>;

/** The Studio's `deleteMedia({ id, usage })` remote command. */
export const deleteMediaInputSchema = deleteMediaQuerySchema.extend({
  id: uuidSchema,
});

export type DeleteMediaInput = z.infer<typeof deleteMediaInputSchema>;

/** The longest content slug a public read accepts. */
export const PUBLIC_CONTENT_SLUG_MAX = 500;

/**
 * A content slug as a public read matches it. An exact-match identifier, so a
 * NUL is refused, never stripped: `a\0b` rewritten to `ab` resolved a different
 * piece, and `\0` rewritten to '' dropped the slug filter and answered a
 * by-slug lookup with the catalogue. The web detail pages 404 a slug this
 * refuses before sending it, so the API's 400 never surfaces as a 500.
 */
export const publicContentSlugSchema = z
  .string()
  .max(PUBLIC_CONTENT_SLUG_MAX)
  .refine(hasNoNul, 'Slug must not contain NUL');

/**
 * An org id that keys a KV cache (Codex-osuqt). Postgres compares uuids
 * case-insensitively, so `?orgId=<UPPERCASE>` read the real rows, but the
 * cache keyed on the raw string: the rows were cached under a key that no
 * publish or org-delete invalidation (which use the lowercase DB id) ever
 * bumped, and were served stale for the full TTL. Lowercasing gives reads and
 * invalidations one id.
 */
export const orgIdQuerySchema = uuidSchema.transform((id) => id.toLowerCase());

/**
 * A topic (category) slug as `?category=` carries it: unicode letters, numbers
 * and hyphens (matching `slugify`), at most the `categories.slug` column width.
 * A SECURITY control, not just validation: it forbids the public-cache-key
 * delimiter ':' so a value like `x:feat:true` can't forge a different filter
 * combo's cache slot (within-org cache poisoning), and it can't carry a NUL.
 * ASCII-only would wrongly reject legit unicode slugs like `café-del-mar`.
 * /explore normalises its `?category=` with this too (Codex-osuqt).
 */
export const topicSlugSchema = z
  .string()
  .max(TOPIC_SLUG_MAX)
  .regex(/^[\p{L}\p{N}-]+$/u, 'Invalid category slug');

/** The orders a public list can sort by. */
const publicContentSortSchema = z.enum(['newest', 'oldest', 'title']);

/**
 * The most items one page of a public list holds. The API caps a larger
 * `limit` to it; the remote query refuses one, since only our pages call it.
 */
export const PUBLIC_LIST_MAX_LIMIT = 50;

/**
 * Public content query schema (org- or creator-scoped)
 * Used for unauthenticated listing of published content: within an
 * organization (orgId), or by one creator across every org they publish in
 * and their personal space (creatorId, for their public profile, Codex-osuqt).
 * Requires orgId, creatorId or slug to prevent unscoped platform-wide
 * enumeration.
 */
export const publicContentQuerySchema = paginationSchema
  .extend({
    orgId: orgIdQuerySchema.optional(),
    slug: publicContentSlugSchema.optional(),
    contentType: contentTypeEnum.optional(),
    // Topic-category filter — matches a category slug in the same space (org).
    // Powers the landing "Browse by topic" and the /explore ?category= deep
    // link. See topicSlugSchema for why its charset is a security control.
    category: topicSlugSchema.optional(),
    search: createSearchQuerySchema(SEARCH_MAX_QUERY_LENGTH),
    sort: publicContentSortSchema.default('newest'),
    // A user id (BetterAuth text), not a uuid (Codex-osuqt).
    creatorId: userIdSchema.optional(),
    // Creator-flagged featured filter — true returns only featured items,
    // false excludes them. Undefined (default) returns all published items.
    // Accepts boolean or stringified boolean (URL query strings).
    featured: z
      .union([
        z.boolean(),
        z.enum(['true', 'false']).transform((v) => v === 'true'),
      ])
      .optional(),
  })
  .refine((data) => data.orgId || data.creatorId || data.slug, {
    message: 'One of orgId, creatorId or slug must be provided',
    path: ['orgId'],
  })
  // A category lives in one space. Without an org the read is cross-org (a
  // creator's profile spans their orgs and personal space), and matching
  // only their personal categories would silently drop all their org content.
  .refine((data) => !data.category || data.orgId, {
    message: 'category requires orgId',
    path: ['category'],
  })
  .transform((data) => ({
    ...data,
    limit: Math.min(data.limit, PUBLIC_LIST_MAX_LIMIT),
  }));

export type PublicContentQueryInput = z.infer<typeof publicContentQuerySchema>;

/**
 * The arguments of the web `getPublicContent` remote query: an org's public
 * list, called with JS values (numbers, booleans) rather than URL strings.
 *
 * Built from the same field rules as {@link publicContentQuerySchema}, never a
 * copy of them (Codex-osuqt). A remote query is a public HTTP endpoint. An
 * argument this refuses is a clean 400, but one it accepts and the API refuses
 * comes back as an API 400 that SvelteKit turns into a 500, logged at error
 * level. A hand-copied schema had drifted to accept a NUL slug and any page.
 */
export const publicContentArgsSchema = z.object({
  orgId: orgIdQuerySchema,
  slug: publicContentSlugSchema.optional(),
  page: z.number().int().min(1).max(PAGINATION_MAX_PAGE).default(1).optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(PUBLIC_LIST_MAX_LIMIT)
    .default(20)
    .optional(),
  contentType: contentTypeEnum.optional(),
  category: topicSlugSchema.optional(),
  search: createSearchQuerySchema(SEARCH_MAX_QUERY_LENGTH),
  sort: publicContentSortSchema.default('newest').optional(),
  creatorId: userIdSchema.optional(),
  featured: z.boolean().optional(),
});

/**
 * Discover content query schema (platform-wide)
 * Used by the discover page to browse all published content across organizations.
 * Intentionally omits orgId/slug — platform-wide access is the only valid use case.
 */
export const discoverContentQuerySchema = paginationSchema
  .extend({
    contentType: contentTypeEnum.optional(),
    search: createSearchQuerySchema(SEARCH_MAX_QUERY_LENGTH),
    sort: publicContentSortSchema.default('newest'),
  })
  .transform((data) => ({
    ...data,
    limit: Math.min(data.limit, PUBLIC_LIST_MAX_LIMIT),
  }));

export type DiscoverContentQueryInput = z.infer<
  typeof discoverContentQuerySchema
>;

// ============================================================================
// Slug Availability Check Schema
// ============================================================================

/**
 * Check content slug availability
 * Used by the SlugField component for real-time uniqueness feedback.
 *
 * Scoping mirrors the database partial unique indexes:
 * - With organizationId: checks slug + org uniqueness
 * - Without organizationId: checks slug + creator uniqueness (personal content)
 */
export const checkContentSlugSchema = z.object({
  slug: slugSchema,
  organizationId: uuidSchema.optional().nullable(),
  excludeContentId: uuidSchema.optional().nullable(),
});

export type CheckContentSlugInput = z.infer<typeof checkContentSlugSchema>;

/**
 * Organization query schema
 * Extends pagination with organization-specific filters and sorting
 */
export const organizationQuerySchema = paginationSchema.extend({
  search: createSearchQuerySchema(255),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt'),
  sortOrder: sortOrderEnum.default('desc'),
});

export type OrganizationQueryInput = z.infer<typeof organizationQuerySchema>;

// ============================================================================
// Upload Request Schema (for multipart upload initiation)
// ============================================================================

/**
 * Upload request validation
 * Used to initiate direct upload to R2
 *
 * Security:
 * - Validates file size before upload
 * - Validates MIME type against whitelist
 * - Prevents directory traversal in filename
 */
export const uploadRequestSchema = z.object({
  filename: z
    .string()
    .min(1, 'Filename is required')
    .max(255, 'Filename must be 255 characters or less')
    .regex(/^[a-zA-Z0-9._-]+$/, 'Filename contains invalid characters'),

  contentType: mimeTypeSchema,

  fileSizeBytes: z
    .number()
    .int('File size must be a whole number')
    .min(1, 'File size must be greater than 0')
    .max(5 * 1024 * 1024 * 1024, 'File size cannot exceed 5GB'),

  title: sanitizedStringSchema(1, 255, 'Title'),
  description: optionalTextSchema(1000, 'Description'),
  mediaType: mediaTypeEnum,
});

export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

// ============================================================================
// Exports Summary
// ============================================================================

/**
 * Re-export all schemas and types for convenience
 *
 * Usage in service layer:
 * ```typescript
 * import { createContentSchema, type CreateContentInput } from '@codex/validation';
 *
 * const validated = createContentSchema.parse(userInput);
 * const content = await contentService.create(validated, creatorId);
 * ```
 */
