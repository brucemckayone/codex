import { z } from 'zod';
import { salePriceCentsSchema, uuidSchema } from '../primitives';
import { paginationSchema } from '../shared/pagination-schema';
import { createSearchQuerySchema } from '../shared/search-schema';
import { checkoutRedirectUrlSchema } from './purchase';

/**
 * Subscription Validation Schemas
 *
 * Validates subscription tier management, checkout, and lifecycle operations.
 *
 * Database constraint alignment:
 * - subscription_tiers.sort_order: positive integer (CHECK sort_order > 0)
 * - subscription_tiers.price_monthly/annual: non-negative integer in pence
 * - subscriptions.status: 'active' | 'past_due' | 'cancelling' | 'cancelled' | 'incomplete' | 'paused'
 * - subscriptions.billing_interval: 'month' | 'year'
 * - stripe_connect_accounts.status: 'onboarding' | 'active' | 'restricted' | 'disabled'
 *
 * Security:
 * - Checkout redirect URLs use the same domain whitelist as purchases
 * - UUIDs validated on all ID inputs
 * - String lengths match database column constraints
 */

// ============================================================================
// Enums (aligned with database CHECK constraints)
// ============================================================================

export const subscriptionStatusEnum = z.enum(
  ['active', 'past_due', 'cancelling', 'cancelled', 'incomplete', 'paused'],
  { message: 'Invalid subscription status' }
);

export const billingIntervalEnum = z.enum(['month', 'year'], {
  message: 'Billing interval must be month or year',
});

export const connectAccountStatusEnum = z.enum(
  ['onboarding', 'active', 'restricted', 'disabled'],
  { message: 'Invalid connect account status' }
);

// ============================================================================
// Tier Schemas
// ============================================================================

const baseTierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tier name is required')
    .max(100, 'Tier name must be 100 characters or less'),
  description: z
    .string()
    .trim()
    .max(500, 'Description must be 500 characters or less')
    .optional(),
  priceMonthly: salePriceCentsSchema,
  priceAnnual: salePriceCentsSchema,
  isRecommended: z.boolean().optional(),
});

export const createTierSchema = baseTierSchema
  .extend({
    /**
     * One id per create attempt, minted by the dialog when it opens
     * (Codex-2hxff.66). The Stripe keys are built from it, so a retry or a
     * double submit with the same id gets back the tier the first attempt made.
     * The dialog mints a new one when the values change after a failed submit:
     * Stripe refuses a reused key with different parameters.
     */
    submissionId: uuidSchema,
    /**
     * "Include everything from…" (Codex-2hxff.91): a live tier of the same
     * org whose films and courses the new tier starts with, copied in the
     * SAME transaction as the insert. A snapshot: later changes to the source
     * don't carry over. Absent or null copies nothing. A replayed
     * `submissionId` returns the first attempt's tier and copies nothing
     * again, so a retry never re-adds items the creator removed meanwhile.
     * Only at creation: `updateTierSchema` has no such field.
     */
    copyAccessFromTierId: uuidSchema.nullable().optional(),
  })
  .refine((data) => data.priceAnnual <= data.priceMonthly * 12, {
    message: 'Annual price must offer equal or better value than monthly',
    path: ['priceAnnual'],
  });

export const updateTierSchema = baseTierSchema.partial().refine(
  (data) => {
    // Only validate annual vs monthly when BOTH prices are present
    if (data.priceMonthly !== undefined && data.priceAnnual !== undefined) {
      return data.priceAnnual <= data.priceMonthly * 12;
    }
    return true;
  },
  {
    message: 'Annual price must offer equal or better value than monthly',
    path: ['priceAnnual'],
  }
);

export const reorderTiersSchema = z.object({
  // 50 is well above any realistic tier count (real orgs rarely exceed 5-10),
  // bounding the two-phase reorder txn's write count. Organisations with more
  // tiers should be handled via admin tooling, not this endpoint.
  tierIds: z
    .array(uuidSchema)
    .min(1, 'At least one tier ID is required')
    .max(50, 'Cannot reorder more than 50 tiers in one call'),
});

// ============================================================================
// Plan access: what each tier includes (Codex-2hxff.91)
// ============================================================================

/** At most this many changes (adds + removes, films + courses) per delta. */
export const PLAN_ITEMS_DELTA_MAX = 200;

/** At most this many ids in one of the delta's four lists. */
export const PLAN_ITEMS_DELTA_LIST_MAX = 100;

/** The tier checklist's page size cap. */
export const PLAN_ITEMS_PAGE_MAX = 50;

/**
 * A list of ids with no repeats. A repeat is refused, not collapsed: the
 * services compare the rows they find with the ids they were sent.
 */
const distinctIds = <T extends z.ZodArray<z.ZodString>>(schema: T) =>
  schema.refine((ids) => new Set(ids).size === ids.length, {
    message: 'The same item is listed twice',
  });

/**
 * `DELETE /api/organizations/:id/tiers/:tierId?onlyHere=keep|move&moveTo=…`.
 *
 * A QUERY, not a body: the old studio sends a bare DELETE, and it must keep
 * working for a tier with nothing only-here. When films or courses are ONLY in
 * this tier, the service refuses a delete without `onlyHere` (409
 * `TierHasOnlyItemsError`), so an old client fails safe instead of leaving
 * them in no tier by accident.
 * - `keep`: they stay subscribers-only with no tier: CLOSED, never free.
 * - `move`: they are added to every tier in `moveTo` (one or more, comma-
 *   separated: `moveTo=<id>,<id>`) in the same transaction. The service
 *   refuses a `moveTo` that is the deleted tier, or not a live tier of the org.
 */
export const deleteTierQuerySchema = z
  .object({
    onlyHere: z
      .enum(['keep', 'move'], {
        message: 'Choose whether to keep or move what is only in this tier',
      })
      .optional(),
    moveTo: z
      .string()
      .transform((raw) => raw.split(','))
      .pipe(
        distinctIds(
          z
            .array(uuidSchema)
            .min(1, 'Choose a tier to move them to')
            .max(50, 'Cannot move them to more than 50 tiers')
        )
      )
      .optional(),
  })
  .refine((q) => q.onlyHere !== 'move' || (q.moveTo?.length ?? 0) > 0, {
    message: 'Choose a tier to move them to',
    path: ['moveTo'],
  })
  .refine((q) => q.onlyHere === 'move' || q.moveTo === undefined, {
    message: 'moveTo needs onlyHere=move',
    path: ['moveTo'],
  });

const planItemIdsSchema = z.object({
  contentIds: distinctIds(
    z
      .array(uuidSchema)
      .max(
        PLAN_ITEMS_DELTA_LIST_MAX,
        `Send at most ${PLAN_ITEMS_DELTA_LIST_MAX} films at a time`
      )
  ).default(() => []),
  courseIds: distinctIds(
    z
      .array(uuidSchema)
      .max(
        PLAN_ITEMS_DELTA_LIST_MAX,
        `Send at most ${PLAN_ITEMS_DELTA_LIST_MAX} courses at a time`
      )
  ).default(() => []),
});

interface PlanItemIdLists {
  contentIds: string[];
  courseIds: string[];
}

const planItemsChangeCount = (d: {
  add: PlanItemIdLists;
  remove: PlanItemIdLists;
}): number =>
  d.add.contentIds.length +
  d.add.courseIds.length +
  d.remove.contentIds.length +
  d.remove.courseIds.length;

const overlaps = (a: string[], b: string[]): boolean => {
  const seen = new Set(a);
  return b.some((id) => seen.has(id));
};

/**
 * BODY of `POST /api/organizations/:id/tiers/:tierId/items`: the tier
 * checklist's save. A DELTA, never the tier's whole set: the checklist only
 * ever sees one page, and a delta is idempotent (add = insert-if-absent,
 * remove = delete), so a resent request lands the same state and composes
 * with an editor save that touches another tier.
 *
 * Removing an item's last tier never makes it free: a subscribers-only film
 * left in no tier is CLOSED (the response's `closedNow` lists them). The
 * service refuses ids outside the tier's eligible set (free, followers-only,
 * team-only and course-only films; anything of another org) and writes
 * nothing.
 *
 * A POST body on a non-partial schema, so the inner defaults are safe
 * here (the Codex-moyu5 trap is `.partial()` only). They are factories, so
 * no two parses share one default array.
 */
export const planItemsDeltaSchema = z
  .object({
    add: planItemIdsSchema.default(() => ({ contentIds: [], courseIds: [] })),
    remove: planItemIdsSchema.default(() => ({
      contentIds: [],
      courseIds: [],
    })),
  })
  .refine(
    (d) => {
      const n = planItemsChangeCount(d);
      return n >= 1 && n <= PLAN_ITEMS_DELTA_MAX;
    },
    { message: `Send between 1 and ${PLAN_ITEMS_DELTA_MAX} changes at a time` }
  )
  .refine(
    (d) =>
      !overlaps(d.add.contentIds, d.remove.contentIds) &&
      !overlaps(d.add.courseIds, d.remove.courseIds),
    { message: 'An item cannot be added and removed in one request' }
  );

/**
 * QUERY of `GET /api/organizations/:id/tiers/:tierId/items`, the tier
 * checklist's rows (a `PaginatedResult`).
 * - `kind`: films, courses, or (absent) both, films first.
 * - `filter`: `included` / `excluded` = ticked or not for THIS tier;
 *   `missing` = ticked for `cheaperTierId` but not for this tier (the
 *   guidance note's "Show them" / "Review").
 * - `search`: the title, as the studio content list searches it.
 */
export const planItemsQuerySchema = paginationSchema
  .extend({
    limit: z.coerce
      .number()
      .int({ message: 'Must be a whole number' })
      .positive({ message: 'Must be greater than 0' })
      .max(PLAN_ITEMS_PAGE_MAX, {
        message: `Must be ${PLAN_ITEMS_PAGE_MAX} or less`,
      })
      .default(20),
    kind: z.enum(['film', 'course']).optional(),
    filter: z.enum(['all', 'included', 'excluded', 'missing']).default('all'),
    cheaperTierId: uuidSchema.optional(),
    search: createSearchQuerySchema(),
  })
  .refine((q) => (q.filter === 'missing') === (q.cheaperTierId !== undefined), {
    message: 'cheaperTierId goes with filter=missing, and only with it',
    path: ['cheaperTierId'],
  });

// ============================================================================
// Subscription Checkout Schemas
// ============================================================================

export const createSubscriptionCheckoutSchema = z.object({
  organizationId: uuidSchema,
  tierId: uuidSchema,
  billingInterval: billingIntervalEnum,
  successUrl: checkoutRedirectUrlSchema,
  cancelUrl: checkoutRedirectUrlSchema,
});

// ============================================================================
// Subscription Management Schemas
// ============================================================================

export const changeTierSchema = z.object({
  organizationId: uuidSchema,
  newTierId: uuidSchema,
  billingInterval: billingIntervalEnum,
  /**
   * Unix timestamp (seconds) returned by `previewTierChange()`. Threading
   * it back to `changeTier()` guarantees the commit-time charge matches
   * the dialog preview to the penny — Stripe re-runs the proration
   * calculation against `Date.now()` if omitted.
   */
  prorationDate: z.number().int().positive().optional(),
});

export const cancelSubscriptionSchema = z.object({
  organizationId: uuidSchema,
  // Free-text reason (legacy field, optional). When `churnReason === 'other'`
  // the client should ensure this is non-empty but we don't enforce that
  // server-side — a user who clicks confirm quickly still gets cancelled.
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or less')
    .optional(),
  // Structured churn taxonomy (Q7). See CHURN_REASON in @codex/constants.
  churnReason: z
    .enum([
      'too_expensive',
      'not_enough_content',
      'found_alternative',
      'not_using_it',
      'technical_issues',
      'other',
    ])
    .optional(),
});

export const reactivateSubscriptionSchema = z.object({
  organizationId: uuidSchema,
});

export const resumeSubscriptionSchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Query Schemas
// ============================================================================

export const listSubscribersQuerySchema = paginationSchema.extend({
  tierId: uuidSchema.optional(),
  status: subscriptionStatusEnum.optional(),
  // BUG-023: `listSubscribers` excludes cancelled rows by default. Set this
  // to `true` from the studio Subscribers page when the operator toggles
  // the "Show cancelled" view. Ignored if `status` is explicitly set.
  includeCancelled: z.coerce.boolean().optional(),
  // Free-text search across user name / email — case-insensitive ILIKE.
  search: createSearchQuerySchema(120),
});

/**
 * Payout status filter for the studio payouts table (Codex-zqaxo).
 *
 * Phase 1 surfaces three states:
 *  - `pending`   — row exists, `resolvedAt IS NULL`
 *  - `resolved`  — `resolvedAt IS NOT NULL` AND `stripeTransferId IS NOT NULL`
 *  - `failed`    — `reason='transfer_failed'` AND unresolved
 *  - `all`       — no status filter (default)
 *
 * The enum is shared by the worker route's query schema below AND the
 * frontend remote function so both ends stay in sync.
 */
export const payoutStatusFilterEnum = z.enum([
  'all',
  'pending',
  'paid',
  'resolved', // legacy URL alias for 'paid' (PR3); dropped in PR4
  'failed',
  'reversed', // Codex-h69cg: refund-reversed rows
  'cancelled_by_refund', // Codex-92ej7 / DQ-9: refund hit before Connect activated
  'cancelled_by_dispute', // Codex-2hxff.9: held for a dispute that was lost
  'needs_attention',
]);

/**
 * Codex-h69cg: tri-party ledger source filter for /studio/payouts.
 *   'all'          → purchases + subscriptions (default, backwards-compatible)
 *   'purchase'     → one-time-purchase rows only
 *   'subscription' → recurring-subscription rows only
 */
export const payoutSourceFilterEnum = z.enum([
  'all',
  'purchase',
  'subscription',
]);

export const listPayoutsQuerySchema = paginationSchema.extend({
  organizationId: uuidSchema,
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  /**
   * Rows TRANSFERRED on or after this (the transfer, else the row's own
   * time, as `bankOn` reads it), not created: a backlog sale released after
   * a late Connect setup has an old `createdAt` and a near bank day.
   */
  transferredFrom: z.string().datetime().optional(),
});

export const getPayoutSummaryQuerySchema = z.object({
  organizationId: uuidSchema,
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * Codex-6nt4l: per-creator payout breakdown for the studio payouts right
 * rail. Mirrors `listPayoutsQuerySchema` minus pagination — the rail
 * intentionally surfaces every paid creator regardless of page (page is a
 * UX construct for the table; the rail aggregates the whole row set).
 *
 * Status/source default to 'all' so a bare GET works for the unfiltered
 * "By creator" panel. They MUST stay in sync with the table's filter chips
 * — both endpoints feed `SubscriptionService.buildPayoutConditions` to
 * guarantee the table and the rail reshape together.
 */
export const getPayoutsByCreatorBreakdownQuerySchema = z.object({
  organizationId: uuidSchema,
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * Creator-self-scoped payouts list (Codex-69t7c.7 / WP7).
 *
 * The creator-earnings counterpart of {@link listPayoutsQuerySchema}: carries
 * NO `organizationId`. The caller is resolved from the session (`ctx.user.id`),
 * never client-supplied (IDOR prevention, epic decision D8). A creator's
 * payouts span every org that paid them, so org-scope is intentionally absent.
 * Status/source/date chips share the enums with the org table for parity.
 */
export const listMyPayoutsQuerySchema = paginationSchema.extend({
  status: payoutStatusFilterEnum.default('all'),
  source: payoutSourceFilterEnum.default('all'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

/**
 * Creator-self-scoped earnings summary (Codex-69t7c.7 / WP7). Dates only — no
 * `organizationId` (session-scoped, spans all orgs).
 */
export const getMyEarningsSummaryQuerySchema = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export type ListMyPayoutsQueryInput = z.infer<typeof listMyPayoutsQuerySchema>;
export type GetMyEarningsSummaryQueryInput = z.infer<
  typeof getMyEarningsSummaryQuerySchema
>;

export const getCurrentSubscriptionQuerySchema = z.object({
  organizationId: uuidSchema,
});

export const getSubscriptionStatsQuerySchema = z.object({
  organizationId: uuidSchema,
});

// ============================================================================
// Stripe Connect Schemas
// ============================================================================

/**
 * `GET /connect/organization-status` — the org's read-only payout status.
 * `organizationId` only RESOLVES the org for the membership check; the handler
 * acts on the policy's `ctx.organizationId`, never on this value directly.
 */
export const connectStatusQuerySchema = z.object({
  organizationId: uuidSchema,
});

/**
 * Creator-scoped Connect onboarding (Codex-69t7c.3 / WP3).
 *
 * Carries NO `organizationId`: the acting creator is always the authenticated
 * user (`ctx.user.id`), never a client-supplied id (IDOR prevention — see epic
 * design decision D8). The
 * return/refresh URLs reuse the same host-allowlisted redirect schema as
 * checkout, so an attacker cannot smuggle an open redirect through onboarding.
 *
 * The sibling `/connect/me/{status,sync,dashboard}` routes take no input — the
 * creator is resolved entirely from the session — so this is the only new
 * creator-scoped Connect schema.
 */
export const connectMeOnboardSchema = z.object({
  returnUrl: checkoutRedirectUrlSchema,
  refreshUrl: checkoutRedirectUrlSchema,
});

// ============================================================================
// Type Exports
// ============================================================================

export type SubscriptionStatus = z.infer<typeof subscriptionStatusEnum>;
export type BillingInterval = z.infer<typeof billingIntervalEnum>;
export type ConnectAccountStatus = z.infer<typeof connectAccountStatusEnum>;

export type CreateTierInput = z.infer<typeof createTierSchema>;
export type UpdateTierInput = z.infer<typeof updateTierSchema>;
export type ReorderTiersInput = z.infer<typeof reorderTiersSchema>;
export type DeleteTierQueryInput = z.infer<typeof deleteTierQuerySchema>;
export type PlanItemsDeltaInput = z.infer<typeof planItemsDeltaSchema>;
export type PlanItemsQueryInput = z.infer<typeof planItemsQuerySchema>;

export type CreateSubscriptionCheckoutInput = z.infer<
  typeof createSubscriptionCheckoutSchema
>;
export type ChangeTierInput = z.infer<typeof changeTierSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
export type ReactivateSubscriptionInput = z.infer<
  typeof reactivateSubscriptionSchema
>;
export type ResumeSubscriptionInput = z.infer<typeof resumeSubscriptionSchema>;
export type PayoutStatusFilter = z.infer<typeof payoutStatusFilterEnum>;
export type PayoutSourceFilter = z.infer<typeof payoutSourceFilterEnum>;
export type ListPayoutsQueryInput = z.infer<typeof listPayoutsQuerySchema>;
export type GetPayoutSummaryQueryInput = z.infer<
  typeof getPayoutSummaryQuerySchema
>;
export type GetPayoutsByCreatorBreakdownQueryInput = z.infer<
  typeof getPayoutsByCreatorBreakdownQuerySchema
>;

export type ListSubscribersQueryInput = z.infer<
  typeof listSubscribersQuerySchema
>;

export type ConnectMeOnboardInput = z.infer<typeof connectMeOnboardSchema>;
